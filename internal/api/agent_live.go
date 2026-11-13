package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"qnetward/internal/store"
)

// The agent live channel: each agent keeps one outbound WebSocket open to the
// console. Over it the console tells the agent to pick up new work at once,
// run a check now, or stream its machine and devices second by second while
// someone is looking. Agents still work without it, on their usual schedule.
const (
	agentLivePing = 25 * time.Second
	// liveModeMax is how long one Live mode request lasts; open pages renew it.
	liveModeMax = 90 * time.Second
	// liveSampleMax caps a live reading an agent may send.
	liveSampleMax = 16 << 10
)

// Live event types: unlogged, second-by-second readings for open pages.
const (
	EventHostLive   = "host.live"
	EventDeviceLive = "device.live"
)

// agentCommand is something the console asks an agent to do.
type agentCommand struct {
	Type      string `json:"type"` // sync, run, run_device, live, live_device
	MonitorID int64  `json:"monitor_id,omitempty"`
	DeviceID  int64  `json:"device_id,omitempty"`
	Seconds   int    `json:"seconds,omitempty"`
	EveryMs   int    `json:"every_ms,omitempty"`
}

// agentLinks holds the live connections of agents connected to this instance.
type agentLinks struct {
	mu    sync.Mutex
	links map[int64]chan []byte
}

func newAgentLinks() *agentLinks { return &agentLinks{links: map[int64]chan []byte{}} }

func (l *agentLinks) add(agentID int64) (chan []byte, func()) {
	ch := make(chan []byte, 32)
	l.mu.Lock()
	// A newer connection from the same agent replaces the old one.
	if old, ok := l.links[agentID]; ok {
		close(old)
	}
	l.links[agentID] = ch
	l.mu.Unlock()
	return ch, func() {
		l.mu.Lock()
		defer l.mu.Unlock()
		if l.links[agentID] == ch {
			delete(l.links, agentID)
			close(ch)
		}
	}
}

// send passes a command to an agent connected here, and says whether it was.
func (l *agentLinks) send(agentID int64, msg []byte) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	ch, ok := l.links[agentID]
	if !ok {
		return false
	}
	select {
	case ch <- msg:
	default: // a stalled agent misses a command; its schedule carries on
	}
	return true
}

// commandAgent sends a command to an agent, wherever it is connected.
func (srv *Server) commandAgent(agentID int64, cmd agentCommand) {
	msg, _ := json.Marshal(cmd)
	if srv.events.listening.Load() {
		if lg := srv.events.eventLog(); lg != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			err := lg.NotifyAgent(ctx, agentID, msg)
			cancel()
			if err == nil {
				return // every instance hears it; the one holding the agent passes it on
			}
		}
	}
	srv.agentLinks.send(agentID, msg)
}

// syncAgents tells a workspace's agents to fetch their work now, after
// monitors or devices changed, instead of at their next check-in.
func (srv *Server) syncAgents(workspaceID int64) {
	if srv.store == nil {
		return
	}
	srv.background.Add(1)
	go func() {
		defer srv.background.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		agents, err := srv.store.ListAgents(ctx, workspaceID)
		if err != nil {
			return
		}
		for _, a := range agents {
			if a.Enrolled && a.Online {
				srv.commandAgent(a.ID, agentCommand{Type: "sync"})
			}
		}
	}()
}

// publishLive sends an unlogged live reading to the workspace's open consoles
// on every instance. Readings come every second or two, so they skip the
// event log: a console that misses one simply shows the next.
func (h *eventHub) publishLive(workspaceID int64, evt liveEvent) {
	if evt.At == 0 {
		evt.At = time.Now().UnixMilli()
	}
	if h.listening.Load() {
		if lg := h.eventLog(); lg != nil {
			msg, _ := json.Marshal(evt)
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			err := lg.NotifyLive(ctx, workspaceID, msg)
			cancel()
			if err == nil {
				return
			}
		}
	}
	h.deliver(workspaceID, evt)
}

// handleAgentLive is the agent's live connection.
func (srv *Server) handleAgentLive(w http.ResponseWriter, r *http.Request) {
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}
	secret, ok := bearerToken(r)
	if !ok || !strings.HasPrefix(secret, agentSecretPrefix) {
		writeJSON(w, http.StatusUnauthorized, apiError{Error: store.ErrAgentCredentials.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	agent, err := srv.store.AgentHeartbeat(ctx, hashOpaqueToken(secret), store.AgentInfo{RemoteIP: clientIPFromRequest(r)})
	cancel()
	if err != nil {
		if errors.Is(err, store.ErrAgentCredentials) {
			writeJSON(w, http.StatusUnauthorized, apiError{Error: "this agent was removed or its secret is wrong; enroll it again"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "live connection failed"})
		return
	}
	if agent.BackOnline {
		srv.agentBackOnline(agent)
	}
	// Agents aren't browsers: they send no Origin, and authenticate by secret.
	up := websocket.Upgrader{ReadBufferSize: 4096, WriteBufferSize: 4096, CheckOrigin: func(*http.Request) bool { return true }}
	conn, err := up.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	conn.SetReadLimit(liveSampleMax)

	commands, remove := srv.agentLinks.add(agent.ID)
	defer remove()
	srv.events.publish(agent.WorkspaceID, liveEvent{Type: EventAgent})

	// Reader: the agent sends live readings, and pongs.
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = conn.SetReadDeadline(time.Now().Add(2 * agentLivePing))
		conn.SetPongHandler(func(string) error { return conn.SetReadDeadline(time.Now().Add(2 * agentLivePing)) })
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			_ = conn.SetReadDeadline(time.Now().Add(2 * agentLivePing))
			srv.agentLiveMessage(agent, data)
		}
	}()

	ping := time.NewTicker(agentLivePing)
	defer ping.Stop()
	write := func(msg []byte) bool {
		_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return conn.WriteMessage(websocket.TextMessage, msg) == nil
	}
	if !write([]byte(`{"type":"hello"}`)) {
		return
	}
	for {
		select {
		case <-done:
			return
		case msg, ok := <-commands:
			if !ok || !write(msg) {
				return
			}
		case <-ping.C:
			_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if conn.WriteMessage(websocket.PingMessage, nil) != nil {
				return
			}
		}
	}
}

// agentLiveMessage handles one live reading from an agent. Readings are
// cleaned like stored samples, then passed to open consoles without storing.
func (srv *Server) agentLiveMessage(agent store.Agent, data []byte) {
	var msg struct {
		Type   string              `json:"type"`
		Host   *store.HostSample   `json:"host,omitempty"`
		Device *store.DeviceSample `json:"device,omitempty"`
	}
	if json.Unmarshal(data, &msg) != nil {
		return
	}
	switch msg.Type {
	case "host_sample":
		if msg.Host == nil {
			return
		}
		msg.Host.At = time.Now()
		if !msg.Host.Clean() {
			return
		}
		payload, _ := json.Marshal(map[string]any{"agent_id": agent.ID, "sample": msg.Host})
		srv.events.publishLive(agent.WorkspaceID, liveEvent{Type: EventHostLive, Data: payload})
	case "device_sample":
		if msg.Device == nil || msg.Device.DeviceID <= 0 {
			return
		}
		// Only a device this agent polls.
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		d, err := srv.store.GetDevice(ctx, agent.WorkspaceID, msg.Device.DeviceID)
		cancel()
		if err != nil || d.AgentID == nil || *d.AgentID != agent.ID {
			return
		}
		msg.Device.At = time.Now()
		msg.Device.Clean()
		payload, _ := json.Marshal(map[string]any{"device_id": d.ID, "sample": msg.Device})
		srv.events.publishLive(agent.WorkspaceID, liveEvent{Type: EventDeviceLive, Data: payload})
	}
}

// handleHostLive turns on Live mode for a host: its agent streams readings
// every second for the next minute and a half. Open pages renew it.
func (srv *Server) handleHostLive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActorFor(w, r, store.ScopeRead)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "id must be a host id"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	agents, err := srv.store.ListAgents(ctx, user.WorkspaceID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	for _, a := range agents {
		if a.ID == id {
			if !a.Online {
				writeJSON(w, http.StatusConflict, apiError{Error: "this host's agent is offline"})
				return
			}
			srv.commandAgent(id, agentCommand{Type: "live", Seconds: int(liveModeMax.Seconds()), EveryMs: 1000})
			writeJSON(w, http.StatusOK, map[string]any{"live_seconds": int(liveModeMax.Seconds()), "every_ms": 1000})
			return
		}
	}
	writeJSON(w, http.StatusNotFound, apiError{Error: "host not found"})
}

// handleDeviceLive turns on Live mode for a network device: its agent polls it
// every two seconds for the next minute and a half.
func (srv *Server) handleDeviceLive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActorFor(w, r, store.ScopeRead)
	if !ok {
		return
	}
	id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "id must be a device id"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	d, err := srv.store.GetDevice(ctx, user.WorkspaceID, id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, apiError{Error: store.ErrDeviceNotFound.Error()})
		return
	}
	if d.AgentID == nil || !d.AgentOnline || !d.Enabled {
		writeJSON(w, http.StatusConflict, apiError{Error: "this device's agent is offline"})
		return
	}
	srv.commandAgent(*d.AgentID, agentCommand{Type: "live_device", DeviceID: d.ID, Seconds: int(liveModeMax.Seconds()), EveryMs: 2000})
	writeJSON(w, http.StatusOK, map[string]any{"live_seconds": int(liveModeMax.Seconds()), "every_ms": 2000})
}

// handleMonitorRun checks a monitor now: on the servers, and on every agent
// it runs from. Results arrive as usual, through live events.
func (srv *Server) handleMonitorRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActorFor(w, r, store.ScopeWrite)
	if !ok {
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "id must be a monitor id"})
		return
	}
	// A check per monitor at most every ten seconds, so the button can't be a load generator.
	if !srv.enforceRateLimit(w, r, "monitor-run", strconv.FormatInt(id, 10), rateLimitConfig{Limit: 1, Window: 10 * time.Second}) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	monitors, err := srv.store.ListMonitors(ctx, user.WorkspaceID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	for _, m := range monitors {
		if m.ID != id {
			continue
		}
		m.WorkspaceID = user.WorkspaceID
		runs := 0
		for _, loc := range m.Locations {
			if loc.AgentID == 0 {
				srv.background.Add(1)
				go func(m store.Monitor) {
					defer srv.background.Done()
					srv.checkMonitor(context.Background(), m)
				}(m)
			} else {
				srv.commandAgent(loc.AgentID, agentCommand{Type: "run", MonitorID: m.ID})
			}
			runs++
		}
		if runs == 0 { // a monitor saved before locations existed runs from the servers
			srv.background.Add(1)
			go func(m store.Monitor) {
				defer srv.background.Done()
				srv.checkMonitor(context.Background(), m)
			}(m)
			runs = 1
		}
		log.Printf("monitor %d: run now from %d places", m.ID, runs)
		writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "places": runs})
		return
	}
	writeJSON(w, http.StatusNotFound, apiError{Error: store.ErrMonitorNotFound.Error()})
}
