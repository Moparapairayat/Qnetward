package api

import (
	"context"
	"net/http"
	"time"

	"qnetward/internal/engine/traceroute"
	"qnetward/internal/probe"
	"qnetward/internal/store"
)

type tracerouteRequest struct {
	Target    string `json:"target"`
	MaxHops   int    `json:"max_hops,omitempty"`
	Queries   int    `json:"queries,omitempty"`
	TimeoutMs int    `json:"timeout_ms,omitempty"`
	IPv6      bool   `json:"ipv6,omitempty"`
}

// handleTraceroute traces the route to a public host and returns every hop.
// It counts against the workspace's hourly probe quota, like a ping.
func (srv *Server) handleTraceroute(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActorFor(w, r, store.ScopeProbe)
	if !ok {
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	var req tracerouteRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	target, err := probe.NormalizeHost(req.Target)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	timeout := traceroute.DefaultTimeout
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	if timeout < 300*time.Millisecond || timeout > 3*time.Second {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "timeout must be between 300 and 3000 ms"})
		return
	}
	if req.MaxHops < 0 || req.MaxHops > 40 || req.Queries < 0 || req.Queries > traceroute.MaxQueries {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "use up to 40 hops and up to 5 probes per hop"})
		return
	}

	if !srv.enforceWorkspaceQuota(w, user, quotaProbe) {
		return
	}
	release, ok := srv.tryAcquireProbeSlot()
	if !ok {
		writeJSON(w, http.StatusTooManyRequests, apiError{Error: "server busy, try again"})
		return
	}
	defer release()

	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	res, err := traceroute.Run(ctx, target, traceroute.Config{
		MaxHops:      req.MaxHops,
		Queries:      req.Queries,
		Timeout:      timeout,
		ForceIPv6:    req.IPv6,
		ResolveNames: true,
		AddrCheck:    srv.targetPolicy.CheckIP,
	})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, res)
}
