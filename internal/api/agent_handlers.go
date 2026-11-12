package api

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/engine/report"
	"qnetward/internal/store"
)

const (
	agentEnrollPrefix   = "qne_"
	agentSecretPrefix   = "qna_"
	agentEnrollTTL      = time.Hour
	agentHeartbeatEvery = 30 * time.Second
)

type agentCreateResponse struct {
	Agent store.Agent `json:"agent"`
	// EnrollToken is shown once; the agent trades it for its own secret.
	EnrollToken string    `json:"enroll_token"`
	ExpiresAt   time.Time `json:"expires_at"`
}

// handleAgents lists, adds, and removes the workspace's probe agents. Any
// member can see them; owners and admins add and remove them.
func (srv *Server) handleAgents(w http.ResponseWriter, r *http.Request) {
	user, ok := srv.requireActor(w, r)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if r.Method == http.MethodGet {
		agents, err := srv.store.ListAgents(ctx, user.WorkspaceID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"agents": agents, "limit": user.Plan.Limits.Agents})
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	if user.Role != "owner" && user.Role != "admin" {
		writeJSON(w, http.StatusForbidden, apiError{Error: "only workspace owners and admins can manage agents"})
		return
	}
	if srv.isDemoUser(user.User) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "the shared demo account can't add agents"})
		return
	}

	switch r.Method {
	case http.MethodPost:
		var req struct {
			Name string `json:"name"`
		}
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		secret, _, err := generateOpaqueToken()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not generate a token"})
			return
		}
		token := agentEnrollPrefix + secret
		expires := time.Now().Add(agentEnrollTTL)
		agent, err := srv.store.CreateAgent(ctx, user.WorkspaceID, user.ID, req.Name, hashOpaqueToken(token), expires, user.Plan.Limits.Agents)
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, store.ErrAgentLimit) {
				status = http.StatusConflict
			}
			writeJSON(w, status, apiError{Error: err.Error()})
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "agent.created", idTarget("agent", agent.ID, agent.Name), nil)
		writeJSON(w, http.StatusCreated, agentCreateResponse{Agent: agent, EnrollToken: token, ExpiresAt: expires.UTC()})
	case http.MethodDelete:
		id, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("id")), 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "valid agent id is required"})
			return
		}
		agent, err := srv.store.DeleteAgent(ctx, user.WorkspaceID, id)
		if err != nil {
			if errors.Is(err, store.ErrAgentNotFound) {
				writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "agent.deleted", idTarget("agent", agent.ID, agent.Name), nil)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": id})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

type agentHello struct {
	Token    string `json:"token,omitempty"`
	Version  string `json:"version"`
	Hostname string `json:"hostname"`
	Platform string `json:"platform"`
}

func (h agentHello) info(r *http.Request) store.AgentInfo {
	return store.AgentInfo{Version: h.Version, Hostname: h.Hostname, Platform: h.Platform, RemoteIP: clientIPFromRequest(r)}
}

// handleAgentEnroll is called by the agent, without a session, to trade its
// enrollment token for a long-lived secret.
func (srv *Server) handleAgentEnroll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}
	if !srv.enforceRateLimit(w, r, "agent-enroll", "", rateLimitConfig{Limit: 10, Window: 15 * time.Minute}) {
		return
	}
	var req agentHello
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	token := strings.TrimSpace(req.Token)
	if !strings.HasPrefix(token, agentEnrollPrefix) {
		writeJSON(w, http.StatusUnauthorized, apiError{Error: store.ErrEnrollmentToken.Error()})
		return
	}
	raw, _, err := generateOpaqueToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not generate a secret"})
		return
	}
	secret := agentSecretPrefix + raw
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	agent, err := srv.store.EnrollAgent(ctx, hashOpaqueToken(token), hashOpaqueToken(secret), req.info(r))
	if err != nil {
		if errors.Is(err, store.ErrEnrollmentToken) {
			writeJSON(w, http.StatusUnauthorized, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "enrollment failed"})
		return
	}
	srv.recordAudit(r, agent.WorkspaceID, store.User{}, "agent.enrolled", idTarget("agent", agent.ID, agent.Name),
		map[string]any{"hostname": agent.Hostname, "version": agent.Version})
	srv.events.publish(agent.WorkspaceID, liveEvent{Type: "agent.changed"})
	writeJSON(w, http.StatusOK, map[string]any{
		"agent_id":          agent.ID,
		"name":              agent.Name,
		"secret":            secret,
		"heartbeat_seconds": int(agentHeartbeatEvery / time.Second),
		"metrics_seconds":   int(hostMetricsEvery / time.Second),
	})
}

// handleAgentHeartbeat is the agent checking in with its secret. The answer
// lists the monitors the agent runs, so a change in the console reaches it
// within one heartbeat.
func (srv *Server) handleAgentHeartbeat(w http.ResponseWriter, r *http.Request) {
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
	var req agentHello
	if r.ContentLength != 0 {
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	agent, err := srv.store.AgentHeartbeat(ctx, hashOpaqueToken(secret), req.info(r))
	if err != nil {
		if errors.Is(err, store.ErrAgentCredentials) {
			writeJSON(w, http.StatusUnauthorized, apiError{Error: "this agent was removed or its secret is wrong; enroll it again"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "heartbeat failed"})
		return
	}
	if agent.BackOnline {
		srv.agentBackOnline(agent)
	}
	monitors, err := srv.store.AgentMonitors(ctx, agent.WorkspaceID, agent.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "heartbeat failed"})
		return
	}
	jobs := make([]agentJob, 0, len(monitors))
	for _, m := range monitors {
		jobs = append(jobs, agentJob{MonitorID: m.ID, Protocol: m.Protocol, Target: m.Target, Port: m.Port, IntervalSeconds: m.IntervalSeconds, ExpectedStatus: m.ExpectedStatus})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"agent_id":          agent.ID,
		"name":              agent.Name,
		"heartbeat_seconds": int(agentHeartbeatEvery / time.Second),
		"metrics_seconds":   int(hostMetricsEvery / time.Second),
		"jobs":              jobs,
		"devices":           srv.agentDeviceJobs(ctx, agent),
	})
}

// agentJob is a monitor an agent checks on its own schedule.
type agentJob struct {
	MonitorID       int64  `json:"monitor_id"`
	Protocol        string `json:"protocol"`
	Target          string `json:"target"`
	Port            *int   `json:"port,omitempty"`
	IntervalSeconds int    `json:"interval_seconds"`
	ExpectedStatus  *int   `json:"expected_status,omitempty"`
}

// agentResult is one check an agent ran.
type agentResult struct {
	MonitorID    int64      `json:"monitor_id"`
	CheckedAt    time.Time  `json:"checked_at"`
	OK           bool       `json:"ok"`
	RttMs        *float64   `json:"rtt_ms,omitempty"`
	LossPercent  float64    `json:"loss_percent"`
	StatusCode   *int       `json:"status_code,omitempty"`
	Error        string     `json:"error,omitempty"`
	TLSExpiresAt *time.Time `json:"tls_expires_at,omitempty"`
	// Samples are the individual pings or connects of a ping or TCP check.
	Samples []agentSample `json:"samples,omitempty"`
}

// agentSample is one ping or TCP connect within a check.
type agentSample struct {
	Seq   int      `json:"seq"`
	RttMs *float64 `json:"rtt_ms,omitempty"`
	Error string   `json:"error,omitempty"`
	Addr  string   `json:"addr,omitempty"`
}

// agentSamplesMax caps the samples taken from one check.
const agentSamplesMax = 10

// recordAgentSamples writes a ping or TCP check's samples to History, as the
// server does for its own, and returns their summary for the alert rules.
// The summary is worked out here, not taken from the agent.
func (srv *Server) recordAgentSamples(m store.Monitor, res agentResult) *report.Summary {
	if m.Protocol == "http" || len(res.Samples) == 0 {
		return nil
	}
	samples := res.Samples[:min(len(res.Samples), agentSamplesMax)]
	port := monitorPort(m)
	var summary report.Summary
	var total time.Duration
	for _, s := range samples {
		r := report.Result{Seq: s.Seq, Error: strings.TrimSpace(s.Error), Addr: s.Addr}
		if len(r.Error) > 200 {
			r.Error = r.Error[:200]
		}
		if len(r.Addr) > 64 {
			r.Addr = r.Addr[:64]
		}
		summary.Sent++
		if s.RttMs != nil && *s.RttMs >= 0 && *s.RttMs <= 600000 && r.Error == "" {
			r.RTT = time.Duration(*s.RttMs * float64(time.Millisecond))
			summary.Recv++
			total += r.RTT
		} else if r.Error == "" {
			r.Error = "no reply"
		}
		srv.storeResult(m.WorkspaceID, m.UserID, m.Protocol, m.Target, r.Addr, port, r, res.CheckedAt)
	}
	summary.Loss = float64(summary.Sent-summary.Recv) / float64(summary.Sent) * 100
	if summary.Recv > 0 {
		summary.Avg = total / time.Duration(summary.Recv)
	}
	return &summary
}

const (
	agentResultsMax = 100
	// Results older than this are dropped: the monitor has moved on.
	agentResultMaxAge = time.Hour
)

// handleAgentResults takes checks an agent ran and records them as if the
// server had run them. Results for monitors the agent doesn't run are skipped.
func (srv *Server) handleAgentResults(w http.ResponseWriter, r *http.Request) {
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
		Results []agentResult `json:"results"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if len(req.Results) > agentResultsMax {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "send at most 100 results at a time"})
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
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "saving results failed"})
		return
	}
	if agent.BackOnline {
		srv.agentBackOnline(agent)
	}

	now := time.Now()
	accepted := 0
	for _, res := range req.Results {
		if res.CheckedAt.IsZero() || now.Sub(res.CheckedAt) > agentResultMaxAge {
			continue
		}
		if res.CheckedAt.After(now) {
			res.CheckedAt = now
		}
		m, err := srv.store.AgentMonitor(ctx, agent.WorkspaceID, agent.ID, res.MonitorID)
		if err != nil {
			continue
		}
		if err := srv.recordMonitorCheck(m, res.check(agent.ID), srv.recordAgentSamples(m, res)); err != nil {
			if !errors.Is(err, store.ErrMonitorNotFound) {
				log.Printf("recording agent %d check for monitor %d failed: %v", agent.ID, m.ID, err)
			}
			continue
		}
		accepted++
	}
	writeJSON(w, http.StatusOK, map[string]any{"accepted": accepted})
}

func (res agentResult) check(agentID int64) store.MonitorCheck {
	check := store.MonitorCheck{
		CheckedAt:    res.CheckedAt,
		OK:           res.OK,
		RttMs:        res.RttMs,
		LossPercent:  min(max(res.LossPercent, 0), 100),
		StatusCode:   res.StatusCode,
		Error:        strings.TrimSpace(res.Error),
		TLSExpiresAt: res.TLSExpiresAt,
		AgentID:      &agentID,
	}
	if len(check.Error) > 500 {
		check.Error = check.Error[:500]
	}
	if check.RttMs != nil && (*check.RttMs < 0 || *check.RttMs > 600000) {
		check.RttMs = nil
	}
	return check
}
