package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/plans"
	"qnetward/internal/store"
)

func (srv *Server) requireAuthenticatedUser(w http.ResponseWriter, r *http.Request) (store.User, bool) {
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return store.User{}, false
	}
	user, _, err := srv.currentSessionUser(r)
	if err != nil {
		if errors.Is(err, store.ErrSessionNotFound) || errors.Is(err, http.ErrNoCookie) {
			writeJSON(w, http.StatusUnauthorized, apiError{Error: "authentication required"})
			return store.User{}, false
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return store.User{}, false
	}
	return user, true
}

// actor is whoever is acting inside a workspace: a signed-in user in their
// active workspace, or an API key in the workspace it belongs to. Data they
// create (probe results, alert rules) belongs to that workspace.
type actor struct {
	store.User
	WorkspaceID int64
	// Role is the user's role in that workspace: owner, admin, member, or
	// viewer. API keys have the role "api".
	Role string
	// APIKey is set when the request authenticated with a key.
	APIKey *store.APIKey
	// Plan is the workspace's plan, which sets its limits.
	Plan plans.Plan
}

// apiKeyPrefix starts every API key, so keys are easy to recognise and to
// find with secret scanners.
const apiKeyPrefix = "qnw_"

// requireActor authenticates a request to a workspace endpoint. Browser
// sessions act in their active workspace. API keys act in their own
// workspace and need the read scope for GET requests and write otherwise.
func (srv *Server) requireActor(w http.ResponseWriter, r *http.Request) (actor, bool) {
	scope := store.ScopeWrite
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		scope = store.ScopeRead
	}
	return srv.requireActorFor(w, r, scope)
}

// requireActorFor is requireActor with an explicit scope for API keys. An
// empty scope admits browser sessions only.
func (srv *Server) requireActorFor(w http.ResponseWriter, r *http.Request, scope string) (actor, bool) {
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return actor{}, false
	}
	if token, ok := bearerToken(r); ok {
		if scope == "" {
			writeJSON(w, http.StatusForbidden, apiError{Error: "this endpoint needs a signed-in session, not an API key"})
			return actor{}, false
		}
		return srv.authenticateAPIKey(w, r, token, scope)
	}
	user, _, activeWorkspaceID, err := srv.currentSessionState(r)
	if err != nil {
		if errors.Is(err, store.ErrSessionNotFound) || errors.Is(err, http.ErrNoCookie) {
			writeJSON(w, http.StatusUnauthorized, apiError{Error: "authentication required"})
			return actor{}, false
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return actor{}, false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	workspace, err := srv.resolveActiveWorkspace(ctx, user, activeWorkspaceID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return actor{}, false
	}
	if !roleMayAct(workspace.Role, scope, r.Method) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "viewers can see this workspace but not change it; ask an owner or admin for the member role"})
		return actor{}, false
	}
	return actor{User: user, WorkspaceID: workspace.ID, Role: workspace.Role, Plan: plans.For(workspace.Plan)}, true
}

// roleMayAct is the one place a workspace role meets what a request wants to
// do. Viewers read: they may use read endpoints (including reads sent as POST,
// such as Live mode or an export) but not change anything, run probes or scans,
// or start work. Every workspace endpoint authenticates through requireActorFor,
// so new endpoints follow the rule without remembering it. Team, API key,
// channel, domain, and billing endpoints add their own owner/admin checks on
// top.
func roleMayAct(role, scope, method string) bool {
	if role != "viewer" {
		return true
	}
	switch scope {
	case store.ScopeRead:
		return true
	case "":
		// Session-only endpoints say nothing about intent; judge by the method.
		return method == http.MethodGet || method == http.MethodHead
	default:
		return false
	}
}

func (srv *Server) authenticateAPIKey(w http.ResponseWriter, r *http.Request, token, scope string) (actor, bool) {
	if !strings.HasPrefix(token, apiKeyPrefix) {
		writeJSON(w, http.StatusUnauthorized, apiError{Error: "invalid API key"})
		return actor{}, false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	key, err := srv.store.AuthenticateAPIKey(ctx, hashOpaqueToken(token), clientIPFromRequest(r))
	if err != nil {
		if errors.Is(err, store.ErrAPIKeyNotFound) {
			writeJSON(w, http.StatusUnauthorized, apiError{Error: "invalid, expired, or revoked API key"})
			return actor{}, false
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return actor{}, false
	}
	if !key.HasScope(scope) {
		writeJSON(w, http.StatusForbidden, apiError{Error: fmt.Sprintf("this API key lacks the %s scope", scope)})
		return actor{}, false
	}
	plan := plans.For(key.WorkspacePlan)
	// Each key gets its own per-minute budget, so one busy script can't
	// starve the others or the console.
	if allowed, retry := srv.quotaLimiter.Allow(fmt.Sprintf("key:%d", key.ID), rateLimitConfig{Limit: plan.Limits.APIRequestsPerMinute, Window: time.Minute}); !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())))
		writeJSON(w, http.StatusTooManyRequests, apiError{Error: fmt.Sprintf("this API key is limited to %d requests a minute", plan.Limits.APIRequestsPerMinute)})
		return actor{}, false
	}
	return actor{
		Plan: plan,
		// The key acts on behalf of whoever created it; the audit log names the key.
		User:        store.User{ID: key.CreatedBy, Email: "API key: " + key.Name},
		WorkspaceID: key.WorkspaceID,
		Role:        "api",
		APIKey:      &key,
	}, true
}

// bearerToken returns the token from an "Authorization: Bearer" header.
func bearerToken(r *http.Request) (string, bool) {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if len(header) < 7 || !strings.EqualFold(header[:7], "bearer ") {
		return "", false
	}
	token := strings.TrimSpace(header[7:])
	return token, token != ""
}

func (srv *Server) requirePlatformAdmin(w http.ResponseWriter, r *http.Request) (store.User, bool) {
	user, ok := srv.requireAuthenticatedUser(w, r)
	if !ok {
		return store.User{}, false
	}
	if !srv.isPlatformAdmin(user) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "platform admin access required"})
		return store.User{}, false
	}
	return user, true
}

func (srv *Server) currentSessionState(r *http.Request) (store.User, string, int64, error) {
	tokenHash, err := sessionTokenHashFromRequest(r)
	if err != nil {
		return store.User{}, "", 0, err
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	session, err := srv.store.GetSessionDetailsByToken(ctx, tokenHash)
	if err != nil {
		return store.User{}, "", 0, err
	}
	return session.User, tokenHash, session.ActiveWorkspaceID, nil
}

func (srv *Server) currentSessionUser(r *http.Request) (store.User, string, error) {
	user, tokenHash, _, err := srv.currentSessionState(r)
	if err != nil {
		return store.User{}, "", err
	}
	return user, tokenHash, nil
}

func sessionTokenHashFromRequest(r *http.Request) (string, error) {
	cookie, err := r.Cookie(authCookieName)
	if err != nil {
		return "", err
	}
	token := strings.TrimSpace(cookie.Value)
	if token == "" {
		return "", http.ErrNoCookie
	}
	return hashSessionToken(token), nil
}

func (srv *Server) issueSession(w http.ResponseWriter, r *http.Request, ctx context.Context, user store.User) error {
	token, tokenHash, err := generateSessionToken()
	if err != nil {
		return fmt.Errorf("failed to create session token")
	}
	expiresAt := time.Now().Add(defaultSessionTTL)
	meta := store.SessionMeta{UserAgent: r.UserAgent(), IPAddress: clientIPFromRequest(r)}
	if err := srv.store.CreateSessionWithMeta(ctx, user.ID, tokenHash, expiresAt, meta); err != nil {
		return err
	}
	setSessionCookie(w, r, token, expiresAt)
	return nil
}

func (srv *Server) isPlatformAdmin(user store.User) bool {
	if len(srv.adminEmails) == 0 {
		return false
	}
	_, ok := srv.adminEmails[strings.ToLower(strings.TrimSpace(user.Email))]
	return ok
}

func (srv *Server) platformRoleForUser(user store.User) string {
	if srv.isPlatformAdmin(user) {
		return "admin"
	}
	return "user"
}

func (srv *Server) resolveActiveWorkspace(ctx context.Context, user store.User, activeWorkspaceID int64) (store.WorkspaceContext, error) {
	if activeWorkspaceID > 0 {
		workspace, err := srv.store.GetWorkspaceContextByWorkspaceIDAndUserID(ctx, activeWorkspaceID, user.ID)
		if err == nil {
			return workspace, nil
		}
		if !errors.Is(err, store.ErrWorkspaceMemberNotFound) {
			return store.WorkspaceContext{}, err
		}
	}

	workspace, err := srv.store.GetWorkspaceContextByUserID(ctx, user.ID)
	if err != nil {
		if errors.Is(err, store.ErrUserNotFound) {
			return srv.store.EnsureDefaultWorkspaceForUser(ctx, user)
		}
		return store.WorkspaceContext{}, err
	}
	return workspace, nil
}

func generateSessionToken() (string, string, error) {
	return generateOpaqueToken()
}

func generatePasswordResetToken() (string, string, error) {
	return generateOpaqueToken()
}

func generateVerificationCode() (string, string, error) {
	const digits = "0123456789"
	buf := make([]byte, 6)
	for i := range buf {
		n, err := rand.Int(rand.Reader, bigTen)
		if err != nil {
			return "", "", err
		}
		buf[i] = digits[n.Int64()]
	}
	code := string(buf)
	return code, hashOpaqueToken(code), nil
}

func generateOpaqueToken() (string, string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	return token, hashOpaqueToken(token), nil
}

func hashSessionToken(token string) string {
	return hashOpaqueToken(token)
}

func hashOpaqueToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

var bigTen = func() *big.Int {
	return big.NewInt(10)
}()

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   requestIsSecure(r),
		Expires:  expiresAt,
		MaxAge:   int(time.Until(expiresAt).Seconds()),
	})
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   requestIsSecure(r),
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

func clearLegacyDemoCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     "qnetward_demo",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   requestIsSecure(r),
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

func clearLegacyPreviewCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     "qnetward_preview",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   requestIsSecure(r),
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}
