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

type apiKeyCreateRequest struct {
	Name          string   `json:"name"`
	Scopes        []string `json:"scopes"`
	ExpiresInDays int      `json:"expires_in_days"`
}

type apiKeyCreateResponse struct {
	Key store.APIKey `json:"key"`
	// Token is returned once, at creation, and never stored.
	Token string `json:"token"`
}

var apiKeyExpiryDays = map[int]bool{0: true, 30: true, 90: true, 365: true}

// handleWorkspaceAPIKeys lists, creates, and revokes the active workspace's
// API keys. It needs a signed-in owner or admin; keys can't manage keys.
func (srv *Server) handleWorkspaceAPIKeys(w http.ResponseWriter, r *http.Request) {
	user, ok := srv.requireActorFor(w, r, "")
	if !ok {
		return
	}
	if user.Role != "owner" && user.Role != "admin" {
		writeJSON(w, http.StatusForbidden, apiError{Error: "only workspace owners and admins can manage API keys"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		keys, err := srv.store.ListAPIKeys(ctx, user.WorkspaceID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"keys": keys, "scopes": store.APIKeyScopes})
	case http.MethodPost:
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		if srv.isDemoUser(user.User) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "the shared demo account can't create API keys"})
			return
		}
		var req apiKeyCreateRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
			return
		}
		if !apiKeyExpiryDays[req.ExpiresInDays] {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "expires_in_days must be 0 (never), 30, 90, or 365"})
			return
		}
		secret, _, err := generateOpaqueToken()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not generate a key"})
			return
		}
		token := apiKeyPrefix + secret
		key := store.APIKey{
			WorkspaceID: user.WorkspaceID,
			CreatedBy:   user.ID,
			Name:        req.Name,
			Prefix:      token[:len(apiKeyPrefix)+6],
			Scopes:      req.Scopes,
		}
		if req.ExpiresInDays > 0 {
			expires := time.Now().Add(time.Duration(req.ExpiresInDays) * 24 * time.Hour).UTC()
			key.ExpiresAt = &expires
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		saved, err := srv.store.CreateAPIKey(ctx, key, hashOpaqueToken(token))
		if err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, store.ErrAPIKeyLimit) {
				status = http.StatusConflict
			}
			writeJSON(w, status, apiError{Error: err.Error()})
			return
		}
		saved.CreatorName = user.Name
		srv.recordAudit(r, user.WorkspaceID, user.User, "apikey.created", idTarget("api_key", saved.ID, saved.Name),
			map[string]any{"scopes": strings.Join(saved.Scopes, ","), "prefix": saved.Prefix, "expires_in_days": req.ExpiresInDays})
		writeJSON(w, http.StatusCreated, apiKeyCreateResponse{Key: saved, Token: token})
	case http.MethodDelete:
		if !srv.isAllowedRequestOrigin(r) {
			writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
			return
		}
		id, err := strconv.ParseInt(strings.TrimSpace(r.URL.Query().Get("id")), 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "valid key id is required"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		key, err := srv.store.RevokeAPIKey(ctx, user.WorkspaceID, id)
		if err != nil {
			if errors.Is(err, store.ErrAPIKeyNotFound) {
				writeJSON(w, http.StatusNotFound, apiError{Error: err.Error()})
				return
			}
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		srv.recordAudit(r, user.WorkspaceID, user.User, "apikey.revoked", idTarget("api_key", key.ID, key.Name), map[string]any{"prefix": key.Prefix})
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "key": key})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}
