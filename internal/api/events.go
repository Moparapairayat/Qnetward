package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// Live events tell open consoles that something changed, so they refetch at
// once instead of polling. The hub lives in this process: an event raised by
// another API instance doesn't reach browsers connected here, and the console
// keeps a slow poll for that case.

const (
	eventBuffer    = 32
	eventHeartbeat = 25 * time.Second
	// eventMaxPerWorkspace caps open streams so one workspace can't hold
	// thousands of connections.
	eventMaxPerWorkspace = 50
)

// liveEvent is what a console receives. It names what changed; the console
// fetches the details through the normal API, with the normal checks.
type liveEvent struct {
	Type      string `json:"type"`
	MonitorID int64  `json:"monitor_id,omitempty"`
	Status    string `json:"status,omitempty"`
	At        int64  `json:"at"`
}

type eventHub struct {
	mu   sync.Mutex
	subs map[int64]map[chan []byte]struct{}
}

func newEventHub() *eventHub {
	return &eventHub{subs: map[int64]map[chan []byte]struct{}{}}
}

// subscribe returns a channel of encoded events for the workspace, or false
// when the workspace already has too many streams open.
func (h *eventHub) subscribe(workspaceID int64) (chan []byte, func(), bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.subs[workspaceID]) >= eventMaxPerWorkspace {
		return nil, nil, false
	}
	ch := make(chan []byte, eventBuffer)
	if h.subs[workspaceID] == nil {
		h.subs[workspaceID] = map[chan []byte]struct{}{}
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

// publish sends an event to every stream in the workspace. A stream too slow
// to keep up misses it; its next refetch catches up anyway.
func (h *eventHub) publish(workspaceID int64, evt liveEvent) {
	if h == nil {
		return
	}
	if evt.At == 0 {
		evt.At = time.Now().UnixMilli()
	}
	data, err := json.Marshal(evt)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs[workspaceID] {
		select {
		case ch <- data:
		default:
		}
	}
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
	_, _ = fmt.Fprint(w, "retry: 5000\n\n: connected\n\n")
	flusher.Flush()

	heartbeat := time.NewTicker(eventHeartbeat)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case data := <-events:
			var evt liveEvent
			_ = json.Unmarshal(data, &evt)
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", evt.Type, data); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
