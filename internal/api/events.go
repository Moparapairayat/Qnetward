package api

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"qnetward/internal/platform/notify"
	"qnetward/internal/store"
)

// Live events tell open consoles that something changed, so they update at
// once instead of polling.
//
// Every event is appended to the workspace's log in Postgres, which gives it
// an increasing id, and a trigger announces it with NOTIFY. Each API instance
// listens and pushes announcements to the consoles connected to it, so an
// event raised anywhere reaches everyone. A console that reconnects sends the
// last id it saw and receives what it missed; if that's gone from the log it
// is told to refetch everything.
//
// When no listener is running (tests, no database, or the listening
// connection dropped) the instance delivers its own events directly, so
// consoles connected to it never go quiet.
const (
	eventBuffer    = 64
	eventHeartbeat = 25 * time.Second
	// eventMaxPerWorkspace caps open streams so one workspace can't hold
	// thousands of connections.
	eventMaxPerWorkspace = 50
	// eventBackfillMax is the most missed events replayed on reconnect;
	// beyond it the console refetches instead.
	eventBackfillMax = 500
)

// Event types every console understands. Clients ignore types they don't know.
const (
	EventReady   = "ready"  // sent first on every stream, with the current position
	EventResync  = "resync" // the console missed too much: refetch everything
	EventMonitor = "monitor.check"
	EventAlert   = "alert.changed"
	EventAgent   = "agent.changed"
	EventHost    = "host.changed"
	EventDevice  = "device.changed"
	EventScan    = "security.scan"
	// Changes people make, raised from the audit trail.
	EventMonitorChanged   = "monitor.changed"
	EventSecurityChanged  = "security.changed"
	EventStatusPage       = "status_page.changed"
	EventWorkspaceChanged = "workspace.changed"
)

// auditEvents maps audit actions, by prefix, to the live event that tells
// consoles to refresh. Every change people make already writes the audit
// trail, so this one table makes all of them live.
var auditEvents = []struct{ prefix, event string }{
	{"monitor", EventMonitorChanged},
	{"alert_rule", EventAlert},
	{"agent.", EventAgent},
	{"device", EventDevice},
	{"host_alert", EventHost},
	{"domain", EventSecurityChanged},
	{"scan.", EventSecurityChanged},
	{"security.", EventSecurityChanged},
	{"deep", EventSecurityChanged},
	{"vuln", EventSecurityChanged},
	{"status_page", EventStatusPage},
	{"channel", EventWorkspaceChanged},
	{"member.", EventWorkspaceChanged},
	{"apikey.", EventWorkspaceChanged},
	{"workspace.", EventWorkspaceChanged},
	{"billing.", EventWorkspaceChanged},
}

func auditLiveEvent(action string) string {
	for _, m := range auditEvents {
		if strings.HasPrefix(action, m.prefix) {
			return m.event
		}
	}
	return ""
}

// liveNotice is what a console shows as a toast: something worth interrupting
// for, such as a monitor going down. It is the same message channels and
// email get, so every place says the same thing.
type liveNotice struct {
	Severity string `json:"severity"` // critical, warning, success, info
	Title    string `json:"title"`
	Body     string `json:"body,omitempty"`
	// Href is a path in the console, such as /monitors.
	Href string `json:"href,omitempty"`
}

// liveEvent is what a console receives. It names what changed, and may carry
// the new values when they are small; otherwise the console fetches details
// through the normal API, with the normal checks.
type liveEvent struct {
	ID        int64           `json:"id,omitempty"`
	Type      string          `json:"type"`
	MonitorID int64           `json:"monitor_id,omitempty"`
	Status    string          `json:"status,omitempty"`
	Data      json.RawMessage `json:"data,omitempty"`
	Notice    *liveNotice     `json:"notice,omitempty"`
	At        int64           `json:"at"`
}

// frame is one Server-Sent Events message, ready to write.
func (e liveEvent) frame() []byte {
	data, _ := json.Marshal(e)
	if e.ID > 0 {
		return []byte(fmt.Sprintf("id: %d\nevent: %s\ndata: %s\n\n", e.ID, e.Type, data))
	}
	return []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", e.Type, data))
}

type eventHub struct {
	mu   sync.Mutex
	subs map[int64]map[chan liveEvent]struct{}
	// logOf returns the store that keeps events, or nil without a database.
	// It's read on use because the server's store is set after the hub.
	logOf func() *store.Store
	// listening is true while this instance hears NOTIFY announcements, so
	// delivery goes through them rather than directly.
	listening atomic.Bool
}

func newEventHub() *eventHub {
	return &eventHub{subs: map[int64]map[chan liveEvent]struct{}{}}
}

// subscribe returns a channel of the workspace's events, or false when the
// workspace already has too many streams open.
func (h *eventHub) subscribe(workspaceID int64) (chan liveEvent, func(), bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.subs[workspaceID]) >= eventMaxPerWorkspace {
		return nil, nil, false
	}
	ch := make(chan liveEvent, eventBuffer)
	if h.subs[workspaceID] == nil {
		h.subs[workspaceID] = map[chan liveEvent]struct{}{}
	}
	h.subs[workspaceID][ch] = struct{}{}
	return ch, func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(h.subs[workspaceID], ch)
		if len(h.subs[workspaceID]) == 0 {
			delete(h.subs, workspaceID)
		}
	}, true
}

// publish records an event and gets it to every console of the workspace.
func (h *eventHub) publish(workspaceID int64, evt liveEvent) {
	if h == nil {
		return
	}
	if evt.At == 0 {
		evt.At = time.Now().UnixMilli()
	}
	if lg := h.eventLog(); lg != nil {
		payload, _ := json.Marshal(evt)
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		id, err := lg.AppendEvent(ctx, workspaceID, evt.Type, payload)
		cancel()
		if err == nil {
			evt.ID = id
			if h.listening.Load() {
				return // the listener delivers it, here and on every other instance
			}
		} else {
			log.Printf("recording live event %s failed: %v", evt.Type, err)
		}
	}
	h.deliver(workspaceID, evt)
}

func (h *eventHub) eventLog() *store.Store {
	if h == nil || h.logOf == nil {
		return nil
	}
	return h.logOf()
}

// deliver hands an event to the workspace's open streams. A stream too slow
// to keep up misses it and is told to resync.
func (h *eventHub) deliver(workspaceID int64, evt liveEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[workspaceID] {
		select {
		case ch <- evt:
		default:
			// Full: drop the oldest and ask the console to catch up.
			select {
			case <-ch:
			default:
			}
			select {
			case ch <- liveEvent{Type: EventResync, At: time.Now().UnixMilli()}:
			default:
			}
		}
	}
}

// RunEventBus listens for events from every API instance until ctx ends,
// reconnecting with backoff when the connection drops.
func (srv *Server) RunEventBus(ctx context.Context) {
	h := srv.events
	if h == nil || h.eventLog() == nil {
		return
	}
	backoff := time.Second
	for ctx.Err() == nil {
		started := time.Now()
		err := h.eventLog().Listen(ctx, func() {
			h.listening.Store(true)
			log.Printf("live events: listening")
		}, store.Listeners{
			Event: func(e store.WorkspaceEvent) {
				var evt liveEvent
				if json.Unmarshal(e.Payload, &evt) != nil {
					evt = liveEvent{Type: e.Type}
				}
				evt.ID, evt.Type = e.ID, e.Type
				if evt.At == 0 {
					evt.At = e.At.UnixMilli()
				}
				h.deliver(e.WorkspaceID, evt)
			},
			// A command for an agent: passed on if the agent is connected here.
			Agent: func(agentID int64, msg json.RawMessage) { srv.agentLinks.send(agentID, msg) },
			Live: func(workspaceID int64, msg json.RawMessage) {
				var evt liveEvent
				if json.Unmarshal(msg, &evt) == nil && evt.Type != "" {
					h.deliver(workspaceID, evt)
				}
			},
		})
		h.listening.Store(false)
		if ctx.Err() != nil {
			return
		}
		if time.Since(started) > time.Minute {
			backoff = time.Second
		}
		log.Printf("live events: listener stopped (%v); delivering locally, retrying in %s", err, backoff)
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

// lastEventID is where a reconnecting console left off: the Last-Event-ID
// header the browser sends, or ?since= for clients that set it themselves.
func lastEventID(r *http.Request) int64 {
	raw := strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	if raw == "" {
		raw = r.URL.Query().Get("since")
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id < 0 {
		return -1
	}
	return id
}

// handleEvents streams the workspace's live events as Server-Sent Events.
func (srv *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActor(w, r)
	if !ok {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "streaming isn't supported here"})
		return
	}
	// Subscribe before reading the backlog, so nothing falls between them.
	events, unsubscribe, ok := srv.events.subscribe(user.WorkspaceID)
	if !ok {
		writeJSON(w, http.StatusTooManyRequests, apiError{Error: "too many live connections for this workspace"})
		return
	}
	defer unsubscribe()

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("Connection", "keep-alive")
	// Tells nginx and similar proxies not to buffer the stream.
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	write := func(b []byte) bool {
		if _, err := w.Write(b); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	if !write([]byte("retry: 3000\n\n")) {
		return
	}

	// Catch up: replay what the console missed, or tell it to refetch.
	var sent int64
	if log := srv.events.eventLog(); log != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		since := lastEventID(r)
		switch {
		case since > 0:
			missed, covered, err := log.EventsSince(ctx, user.WorkspaceID, since, eventBackfillMax+1)
			if err != nil || !covered || len(missed) > eventBackfillMax {
				latest, _ := log.LatestEventID(ctx, user.WorkspaceID)
				sent = latest
				write(liveEvent{ID: latest, Type: EventResync, At: time.Now().UnixMilli()}.frame())
				break
			}
			sent = since
			for _, e := range missed {
				var evt liveEvent
				if json.Unmarshal(e.Payload, &evt) != nil {
					evt = liveEvent{Type: e.Type}
				}
				evt.ID, evt.Type = e.ID, e.Type
				if !write(evt.frame()) {
					cancel()
					return
				}
				sent = e.ID
			}
		default:
			sent, _ = log.LatestEventID(ctx, user.WorkspaceID)
		}
		cancel()
	}
	// "ready" carries the stream's position, so even a console that hears
	// nothing before dropping can resume from here.
	if !write(liveEvent{ID: sent, Type: EventReady, At: time.Now().UnixMilli()}.frame()) {
		return
	}

	heartbeat := time.NewTicker(eventHeartbeat)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			if !write([]byte(": ping\n\n")) {
				return
			}
		case evt := <-events:
			// Events already replayed in the catch-up arrive here too; skip them.
			if evt.ID > 0 && evt.ID <= sent {
				continue
			}
			if evt.ID > 0 {
				sent = evt.ID
			}
			if !write(evt.frame()) {
				return
			}
		}
	}
}

// EventNotice carries a toast: an alert also sent to the workspace's channels.
const EventNotice = "notice"

// publishNotice tells open consoles about an alert. group is the channel event
// it belongs to (monitors, hosts, security, ...), so consoles also refresh
// what it's about.
func (srv *Server) publishNotice(workspaceID int64, group string, msg notify.Message) {
	n := &liveNotice{Severity: msg.Severity, Title: msg.Title, Body: msg.Summary}
	if u, err := url.Parse(msg.URL); err == nil && strings.HasPrefix(u.Path, "/") {
		n.Href = u.Path
	}
	data, _ := json.Marshal(map[string]string{"group": group, "event": msg.Event})
	srv.events.publish(workspaceID, liveEvent{Type: EventNotice, Notice: n, Data: data})
}
