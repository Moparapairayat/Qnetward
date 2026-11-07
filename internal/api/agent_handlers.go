package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

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
	})
}

// handleAgentHeartbeat is the agent checking in with its secret. Later it
// will also hand out checks to run.
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
	writeJSON(w, http.StatusOK, map[string]any{
		"agent_id":          agent.ID,
		"name":              agent.Name,
		"heartbeat_seconds": int(agentHeartbeatEvery / time.Second),
		"jobs":              []any{},
	})
}
