package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"

	"qnetward/internal/store"
)

const maxAvatarBytes = 1 << 20

// Raster formats only: SVG can carry script, so it is never accepted.
var avatarTypes = map[string]string{
	"image/png":  "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
	"image/gif":  "gif",
}

type passwordChangeRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

type sessionsResponse struct {
	Sessions []store.SessionInfo `json:"sessions"`
}

type sessionRevokeRequest struct {
	ID     int64 `json:"id"`
	Others bool  `json:"others"`
}

type accountDeleteRequest struct {
	Password string `json:"password"`
	Email    string `json:"email"`
}

type avatarResponse struct {
	AvatarURL string `json:"avatar_url"`
}

// requireAccountUser is the common gate for endpoints that change the signed-in account.
func (srv *Server) requireAccountUser(w http.ResponseWriter, r *http.Request, mutating bool) (store.User, bool) {
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return store.User{}, false
	}
	if mutating && !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return store.User{}, false
	}
	user, ok := srv.requireAuthenticatedUser(w, r)
	if !ok {
		return store.User{}, false
	}
	if mutating && srv.isDemoUser(user) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "demo access cannot change the shared account"})
		return store.User{}, false
	}
	return user, true
}

// checkPassword compares a submitted password with the stored hash, rate limited per account.
func (srv *Server) checkPassword(w http.ResponseWriter, r *http.Request, ctx context.Context, user store.User, password, action string) bool {
	if !srv.enforceRateLimit(w, r, action, strconv.FormatInt(user.ID, 10), rateLimitConfig{Limit: 6, Window: 15 * time.Minute}) {
		return false
	}
	hash, err := srv.store.GetUserPasswordHash(ctx, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not verify password"})
		return false
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		writeJSON(w, http.StatusForbidden, apiError{Error: "current password is incorrect"})
		return false
	}
	return true
}

// handleAccountPassword changes the password of a signed-in user and signs out their other sessions.
func (srv *Server) handleAccountPassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireAccountUser(w, r, true)
	if !ok {
		return
	}
	var req passwordChangeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if n := utf8.RuneCountInString(req.NewPassword); n < minPasswordLength || len(req.NewPassword) > maxPasswordLength {
		writeJSON(w, http.StatusBadRequest, apiError{Error: fmt.Sprintf("new password must be %d to %d characters", minPasswordLength, maxPasswordLength)})
		return
	}
	if req.NewPassword == req.CurrentPassword {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "new password must differ from the current one"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if !srv.checkPassword(w, r, ctx, user, req.CurrentPassword, "account-password") {
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not hash password"})
		return
	}
	currentHash, _ := sessionTokenHashFromRequest(r)
	if err := srv.store.ChangeUserPassword(ctx, user.ID, string(hash), currentHash); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not change password"})
		return
	}
	srv.recordAudit(r, 0, user, "account.password_changed", auditTarget{}, nil)
	writeJSON(w, http.StatusOK, authMessageResponse{OK: true, Message: "Password changed. Other sessions were signed out."})
}

// handleAccountSessions lists (GET) or signs out (DELETE) the user's sessions.
func (srv *Server) handleAccountSessions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodDelete {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireAccountUser(w, r, r.Method == http.MethodDelete)
	if !ok {
		return
	}
	currentHash, _ := sessionTokenHashFromRequest(r)
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if r.Method == http.MethodGet {
		sessions, err := srv.store.ListUserSessions(ctx, user.ID, currentHash)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not load sessions"})
			return
		}
		writeJSON(w, http.StatusOK, sessionsResponse{Sessions: sessions})
		return
	}

	var req sessionRevokeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	switch {
	case req.Others:
		n, err := srv.store.DeleteOtherUserSessions(ctx, user.ID, currentHash)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not sign out other sessions"})
			return
		}
		srv.recordAudit(r, 0, user, "account.sessions_revoked", auditTarget{}, map[string]any{"count": n})
		writeJSON(w, http.StatusOK, authMessageResponse{OK: true, Message: fmt.Sprintf("Signed out %d other %s.", n, plural(n, "session", "sessions"))})
	case req.ID > 0:
		if err := srv.store.DeleteUserSession(ctx, user.ID, req.ID); err != nil {
			if errors.Is(err, store.ErrSessionNotOwned) {
				writeJSON(w, http.StatusNotFound, apiError{Error: "session not found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not sign out session"})
			return
		}
		srv.recordAudit(r, 0, user, "account.session_revoked", idTarget("session", req.ID, ""), nil)
		writeJSON(w, http.StatusOK, authMessageResponse{OK: true, Message: "Session signed out."})
	default:
		writeJSON(w, http.StatusBadRequest, apiError{Error: "pass a session id or others: true"})
	}
}

// handleAccountDelete permanently deletes the signed-in account after re-checking the password.
func (srv *Server) handleAccountDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireAccountUser(w, r, true)
	if !ok {
		return
	}
	var req accountDeleteRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if !strings.EqualFold(strings.TrimSpace(req.Email), user.Email) {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "type your email address to confirm"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if !srv.checkPassword(w, r, ctx, user, req.Password, "account-delete") {
		return
	}
	avatarKey, _ := srv.store.GetUserAvatarKey(ctx, user.ID)
	if err := srv.store.DeleteUserAccount(ctx, user.ID); err != nil {
		if errors.Is(err, store.ErrOwnsSharedWorkspace) {
			names, _ := srv.store.SharedWorkspacesOwnedBy(ctx, user.ID)
			writeJSON(w, http.StatusConflict, apiError{Error: fmt.Sprintf("transfer ownership or remove the other members first: %s", strings.Join(names, ", "))})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not delete account"})
		return
	}
	if avatarKey != "" && srv.objects != nil {
		if err := srv.objects.Delete(ctx, avatarKey); err != nil {
			log.Printf("delete avatar for removed user %d: %v", user.ID, err)
		}
	}
	clearSessionCookie(w, r)
	writeJSON(w, http.StatusOK, authMessageResponse{OK: true, Message: "Account deleted."})
}

// avatarURL is the path that serves the avatar; the version changes with each upload so caches refresh.
func avatarURL(userID int64, key string) string {
	if key == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(key))
	return fmt.Sprintf("/api/avatars/%d?v=%s", userID, hex.EncodeToString(sum[:4]))
}

// handleAccountAvatar uploads (POST, multipart field "file") or removes (DELETE) the avatar.
func (srv *Server) handleAccountAvatar(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireAccountUser(w, r, true)
	if !ok {
		return
	}
	if srv.objects == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "file storage is not configured on this server"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	if r.Method == http.MethodDelete {
		previous, err := srv.store.SetUserAvatarKey(ctx, user.ID, "")
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not remove avatar"})
			return
		}
		srv.deleteObjectQuietly(ctx, previous)
		writeJSON(w, http.StatusOK, avatarResponse{})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarBytes+64<<10)
	file, _, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "send the image as multipart field \"file\", up to 1 MB"})
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxAvatarBytes+1))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "could not read the upload"})
		return
	}
	if len(data) > maxAvatarBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, apiError{Error: "image must be 1 MB or smaller"})
		return
	}
	// Trust the bytes, not the declared type.
	contentType := http.DetectContentType(data)
	ext, allowed := avatarTypes[contentType]
	if !allowed {
		writeJSON(w, http.StatusUnsupportedMediaType, apiError{Error: "use a PNG, JPEG, WebP, or GIF image"})
		return
	}

	nonce := make([]byte, 8)
	if _, err := rand.Read(nonce); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not store avatar"})
		return
	}
	key, err := srv.objects.Put(ctx, fmt.Sprintf("avatars/%d/%s.%s", user.ID, hex.EncodeToString(nonce), ext), contentType, data)
	if err != nil {
		log.Printf("upload avatar for user %d: %v", user.ID, err)
		writeJSON(w, http.StatusBadGateway, apiError{Error: "file storage rejected the upload"})
		return
	}
	previous, err := srv.store.SetUserAvatarKey(ctx, user.ID, key)
	if err != nil {
		srv.deleteObjectQuietly(ctx, key)
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not save avatar"})
		return
	}
	srv.deleteObjectQuietly(ctx, previous)
	writeJSON(w, http.StatusOK, avatarResponse{AvatarURL: avatarURL(user.ID, key)})
}

// handleAvatarImage streams a user's avatar to any signed-in user.
func (srv *Server) handleAvatarImage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if srv.store == nil || srv.objects == nil {
		http.NotFound(w, r)
		return
	}
	if _, ok := srv.requireAuthenticatedUser(w, r); !ok {
		return
	}
	userID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || userID < 1 {
		http.NotFound(w, r)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	key, err := srv.store.GetUserAvatarKey(ctx, userID)
	if err != nil || key == "" {
		http.NotFound(w, r)
		return
	}
	body, contentType, size, err := srv.objects.Get(ctx, key)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer body.Close()
	if _, ok := avatarTypes[contentType]; !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("Content-Security-Policy", "default-src 'none'")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, body)
}

func (srv *Server) deleteObjectQuietly(ctx context.Context, key string) {
	if key == "" || srv.objects == nil {
		return
	}
	if err := srv.objects.Delete(ctx, key); err != nil {
		log.Printf("delete object %s: %v", key, err)
	}
}

func plural(n int64, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}
