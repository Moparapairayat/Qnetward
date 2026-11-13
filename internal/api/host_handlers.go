package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/store"
)

const (
	// hostMetricsEvery is how often agents sample their machine.
	hostMetricsEvery = 60 * time.Second
	// hostSamplesMax is the most samples one request may carry.
	hostSamplesMax = 120
	// hostSampleMaxAge is how old a sample may be and still be stored.
	hostSampleMaxAge = 2 * time.Hour
)

// hostRanges are the history windows the console offers, with their bucket.
var hostRanges = map[string]struct{ span, bucket time.Duration }{
	"1h":  {time.Hour, time.Minute},
	"6h":  {6 * time.Hour, 5 * time.Minute},
	"24h": {24 * time.Hour, 10 * time.Minute},
	"7d":  {7 * 24 * time.Hour, time.Hour},
	"14d": {14 * 24 * time.Hour, 2 * time.Hour},
}

// handleAgentMetrics stores samples of the machine an agent runs on.
func (srv *Server) handleAgentMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}
	secret, ok := bearerToken(r)
	if !ok || !strings.HasPrefix(secret, agentSecretPrefix) {
		writeJSON(w, http.StatusUnauthorized, apiError{Error: store.ErrAgentCredentials.Error()})
		return
	}
	var req struct {
		Info    json.RawMessage    `json:"info"`
		Samples []store.HostSample `json:"samples"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if len(req.Samples) > hostSamplesMax {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "send at most 120 samples at a time"})
		return
	}
	info, err := cleanHostInfo(req.Info)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	agent, err := srv.store.AgentHeartbeat(ctx, hashOpaqueToken(secret), store.AgentInfo{RemoteIP: clientIPFromRequest(r)})
	if err != nil {
		if errors.Is(err, store.ErrAgentCredentials) {
			writeJSON(w, http.StatusUnauthorized, apiError{Error: "this agent was removed or its secret is wrong; enroll it again"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "saving metrics failed"})
		return
	}
	if agent.BackOnline {
		srv.agentBackOnline(agent)
	}

	now := time.Now()
	keep := make([]store.HostSample, 0, len(req.Samples))
	for _, s := range req.Samples {
		if s.At.After(now) {
			s.At = now
		}
		if now.Sub(s.At) > hostSampleMaxAge || !s.Clean() {
			continue
		}
		keep = append(keep, s)
	}
	accepted, err := srv.store.RecordHostMetrics(ctx, agent.ID, agent.WorkspaceID, info, keep)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "saving metrics failed"})
		return
	}
	if accepted > 0 {
		data, _ := json.Marshal(map[string]int64{"agent_id": agent.ID})
		srv.events.publish(agent.WorkspaceID, liveEvent{Type: EventHost, Data: data})
	}
	writeJSON(w, http.StatusOK, map[string]any{"accepted": accepted})
}

// cleanHostInfo keeps the known fields of an agent's description of its
// machine, clipped, so the console never shows arbitrary agent data.
func cleanHostInfo(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var in struct {
		OS              string `json:"os"`
		Platform        string `json:"platform"`
		PlatformVersion string `json:"platform_version"`
		Kernel          string `json:"kernel"`
		Arch            string `json:"arch"`
		CPUModel        string `json:"cpu_model"`
		Cores           int    `json:"cores"`
		MemTotal        uint64 `json:"mem_total"`
		BootTime        int64  `json:"boot_time"`
		Virtualization  string `json:"virtualization,omitempty"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return nil, errors.New("info must be an object")
	}
	clip := func(s string, n int) string {
		s = strings.TrimSpace(s)
		if len(s) > n {
			return s[:n]
		}
		return s
	}
	in.OS, in.Platform, in.PlatformVersion = clip(in.OS, 20), clip(in.Platform, 80), clip(in.PlatformVersion, 40)
	in.Kernel, in.Arch, in.CPUModel, in.Virtualization = clip(in.Kernel, 80), clip(in.Arch, 20), clip(in.CPUModel, 120), clip(in.Virtualization, 40)
	if in.Cores < 0 || in.Cores > 4096 {
		in.Cores = 0
	}
	out, err := json.Marshal(in)
	return out, err
}

// handleHosts lists the workspace's hosts, or with ?id= returns one host's
// history for ?range=.
func (srv *Server) handleHosts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireActorFor(w, r, store.ScopeRead)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	if raw := r.URL.Query().Get("id"); raw != "" {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "id must be a host id"})
			return
		}
		name := r.URL.Query().Get("range")
		rg, ok := hostRanges[name]
		if !ok {
			name, rg = "24h", hostRanges["24h"]
		}
		points, err := srv.store.HostSeries(ctx, user.WorkspaceID, id, time.Now().Add(-rg.span), rg.bucket)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"points": points, "range": name, "bucket_seconds": int(rg.bucket.Seconds())})
		return
	}
	hosts, err := srv.store.ListHosts(ctx, user.WorkspaceID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hosts": hosts, "metrics_seconds": int(hostMetricsEvery.Seconds())})
}
