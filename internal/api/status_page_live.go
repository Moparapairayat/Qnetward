package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"qnetward/internal/store"
)

// handlePublicStatusEvents streams a public status page's changes to visitors.
// It sends only "update" (something on the page changed, fetch it again) and
// "gone" (the page was unpublished): nothing about the workspace, its
// monitors' targets, or their errors ever goes out on it. Visitors then read
// the page through the public endpoint, which shows only what's meant to be
// public.
func (srv *Server) handlePublicStatusEvents(w http.ResponseWriter, r *http.Request) {
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}
	// Each visitor opens one stream; this stops one address opening thousands.
	if !srv.enforceRateLimit(w, r, "status-stream", "", rateLimitConfig{Limit: 30, Window: time.Minute}) {
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "streaming isn't supported here"})
		return
	}
	slug := r.PathValue("slug")
	load := func() (store.StatusPageScope, error) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		return srv.store.PublicStatusPageScope(ctx, slug)
	}
	scope, err := load()
	if err != nil {
		if errors.Is(err, store.ErrStatusPageNotFound) {
			writeJSON(w, http.StatusNotFound, apiError{Error: "status page not found"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "couldn't load the status page"})
		return
	}
	events, unsubscribe, ok := srv.events.subscribePublic(scope.WorkspaceID)
	if !ok {
		writeJSON(w, http.StatusTooManyRequests, apiError{Error: "too many visitors right now; the page still refreshes on its own"})
		return
	}
	defer unsubscribe()

	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("Connection", "keep-alive")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	write := func(s string) bool {
		if _, err := w.Write([]byte(s)); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	if !write("retry: 5000\n\nevent: ready\ndata: {}\n\n") {
		return
	}

	// Changes come in bursts (several monitors, several places); one update
	// a second at most is plenty for a person watching.
	var pending bool
	flush := time.NewTicker(time.Second)
	defer flush.Stop()
	heartbeat := time.NewTicker(eventHeartbeat)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			if !write(": ping\n\n") {
				return
			}
		case <-flush.C:
			if pending {
				pending = false
				if !write("event: update\ndata: {}\n\n") {
					return
				}
			}
		case evt := <-events:
			switch evt.Type {
			case EventMonitor:
				// Only a change of status on one of this page's monitors shows.
				if prev, on := scope.Monitors[evt.MonitorID]; on && evt.Status != "" && evt.Status != prev {
					scope.Monitors[evt.MonitorID] = evt.Status
					pending = true
				}
			case EventMonitorChanged, EventStatusPage:
				// Monitors or the page itself changed: reload what the page shows.
				next, err := load()
				if errors.Is(err, store.ErrStatusPageNotFound) {
					write("event: gone\ndata: {}\n\n")
					return
				}
				if err == nil {
					scope = next
				}
				pending = true
			}
		}
	}
}
