package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"qnetward/internal/platform/mailer"
	"qnetward/internal/store"

	"golang.org/x/crypto/bcrypt"
)

type authRequest struct {
	Name            string `json:"name,omitempty"`
	FirstName       string `json:"first_name,omitempty"`
	LastName        string `json:"last_name,omitempty"`
	Email           string `json:"email"`
	Password        string `json:"password"`
	ConfirmPassword string `json:"confirm_password,omitempty"`
}

type authForgotPasswordRequest struct {
	Email string `json:"email"`
}

type authProfileUpdateRequest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type authResetPasswordRequest struct {
	Token           string `json:"token"`
	Password        string `json:"password"`
	ConfirmPassword string `json:"confirm_password,omitempty"`
}

type authVerifyEmailRequest struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

type authUser struct {
	ID              int64      `json:"id"`
	Name            string     `json:"name"`
	Email           string     `json:"email"`
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

type authSessionResponse struct {
	Authenticated     bool      `json:"authenticated"`
	User              *authUser `json:"user,omitempty"`
	Mode              string    `json:"mode,omitempty"`
	ReadOnly          bool      `json:"read_only,omitempty"`
	PlatformRole      string    `json:"platform_role,omitempty"`
	ActiveWorkspaceID int64     `json:"active_workspace_id,omitempty"`
}

type authMessageResponse struct {
	OK                   bool      `json:"ok"`
	Message              string    `json:"message"`
	PreviewURL           string    `json:"preview_url,omitempty"`
	PreviewCode          string    `json:"preview_code,omitempty"`
	VerificationRequired bool      `json:"verification_required,omitempty"`
	Authenticated        bool      `json:"authenticated,omitempty"`
	User                 *authUser `json:"user,omitempty"`
	Email                string    `json:"email,omitempty"`
	Mode                 string    `json:"mode,omitempty"`
	ReadOnly             bool      `json:"read_only,omitempty"`
}

func (srv *Server) handleAuthSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if srv.store != nil {
		user, _, activeWorkspaceID, err := srv.currentSessionState(r)
		if err == nil {
			mode := "authenticated"
			if srv.isDemoUser(user) {
				mode = "demo"
			}
			writeJSON(w, http.StatusOK, authSessionResponse{
				Authenticated:     true,
				User:              toAuthUser(user),
				Mode:              mode,
				PlatformRole:      srv.platformRoleForUser(user),
				ActiveWorkspaceID: activeWorkspaceID,
			})
			return
		}
		if !errors.Is(err, store.ErrSessionNotFound) && !errors.Is(err, http.ErrNoCookie) {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
	}
	writeJSON(w, http.StatusOK, authSessionResponse{Authenticated: false})
}

func (srv *Server) handleAuthAccountContext(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	user, ok := srv.requireAuthenticatedUser(w, r)
	if !ok {
		return
	}
	_, _, activeWorkspaceID, _ := srv.currentSessionState(r)

	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	workspace, err := srv.resolveActiveWorkspace(ctx, user, activeWorkspaceID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, authWorkspaceContextResponse{
		Workspace: toAuthWorkspace(workspace),
	})
}

func (srv *Server) handleAuthDemoLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.demoEnabled {
		writeJSON(w, http.StatusNotFound, apiError{Error: "demo access is disabled"})
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}

	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	user, err := srv.getOrCreateDemoUser(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	if err := srv.issueSession(w, r, ctx, user); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	srv.recordAudit(r, 0, user, "auth.login", auditTarget{}, map[string]any{"demo": true})
	clearLegacyDemoCookie(w, r)
	clearLegacyPreviewCookie(w, r)
	writeJSON(w, http.StatusOK, authMessageResponse{
		OK:            true,
		Message:       "Demo access granted.",
		Authenticated: true,
		User:          toAuthUser(user),
		Mode:          "demo",
	})
}

func (srv *Server) handleAuthSignup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	var req authRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	name, err := normalizeSignupDisplayName(req.Name, req.FirstName, req.LastName)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	email, err := store.NormalizeEmail(req.Email)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if !srv.enforceRateLimit(w, r, "auth-signup", email, rateLimitConfig{Limit: 5, Window: 15 * time.Minute}) {
		return
	}
	if err := validatePassword(req.Password); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if err := validatePasswordConfirmation(req.Password, req.ConfirmPassword); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "failed to hash password"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	_ = srv.store.DeleteExpiredSessions(ctx)
	_ = srv.store.DeleteExpiredEmailVerificationCodes(ctx)
	user, err := srv.store.CreateUser(ctx, name, email, string(passwordHash), true)
	if err != nil {
		switch {
		case errors.Is(err, store.ErrUserExists):
			writeJSON(w, http.StatusConflict, apiError{Error: "user already exists"})
		default:
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		}
		return
	}

	resp, err := srv.prepareVerificationChallenge(ctx, r, user)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, resp)
}

func (srv *Server) handleAuthLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	var req authRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	email, err := store.NormalizeEmail(req.Email)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if !srv.enforceRateLimit(w, r, "auth-login", email, rateLimitConfig{Limit: 8, Window: 15 * time.Minute}) {
		return
	}
	if strings.TrimSpace(req.Password) == "" {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "password is required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	_ = srv.store.DeleteExpiredSessions(ctx)
	user, passwordHash, err := srv.store.AuthenticateUser(ctx, email)
	if err != nil {
		if errors.Is(err, store.ErrInvalidCredentials) {
			writeJSON(w, http.StatusUnauthorized, apiError{Error: "invalid email or password"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		// Recorded on the account so its owner can see attempts on it.
		srv.recordAudit(r, 0, user, "auth.login_failed", auditTarget{}, nil)
		writeJSON(w, http.StatusUnauthorized, apiError{Error: "invalid email or password"})
		return
	}
	if user.VerificationRequired {
		writeJSON(w, http.StatusForbidden, authMessageResponse{
			OK:                   false,
			Message:              "Email verification required. Enter the OTP sent to your inbox.",
			VerificationRequired: true,
			Email:                user.Email,
		})
		return
	}
	if mfa, _, err := srv.store.GetMFA(ctx, user.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	} else if mfa.Enabled {
		srv.startMFAChallenge(w, ctx, user)
		return
	}

	if err := srv.issueSession(w, r, ctx, user); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	srv.recordAudit(r, 0, user, "auth.login", auditTarget{}, nil)

	writeJSON(w, http.StatusOK, authSessionResponse{
		Authenticated: true,
		User:          toAuthUser(user),
	})
}

func (srv *Server) handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}
	if user, tokenHash, err := srv.currentSessionUser(r); err == nil {
		srv.recordAudit(r, 0, user, "auth.logout", auditTarget{}, nil)
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		_ = srv.store.DeleteSession(ctx, tokenHash)
		cancel()
	} else if tokenHash, err := sessionTokenHashFromRequest(r); err == nil && tokenHash != "" {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		_ = srv.store.DeleteSession(ctx, tokenHash)
		cancel()
	}
	clearSessionCookie(w, r)
	clearLegacyDemoCookie(w, r)
	clearLegacyPreviewCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (srv *Server) handleAuthProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	user, ok := srv.requireAuthenticatedUser(w, r)
	if !ok {
		return
	}
	if srv.isDemoUser(user) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "demo access cannot modify the shared profile"})
		return
	}

	var req authProfileUpdateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	name, err := normalizeDisplayName(req.Name)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	email, err := store.NormalizeEmail(req.Email)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	updatedUser, emailChanged, err := srv.store.UpdateUserProfile(ctx, user.ID, name, email)
	if err != nil {
		switch {
		case errors.Is(err, store.ErrUserExists):
			writeJSON(w, http.StatusConflict, apiError{Error: "user already exists"})
		case errors.Is(err, store.ErrUserNotFound):
			writeJSON(w, http.StatusNotFound, apiError{Error: "user not found"})
		default:
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		}
		return
	}

	if emailChanged {
		resp, challengeErr := srv.prepareVerificationChallenge(ctx, r, updatedUser)
		if challengeErr != nil {
			log.Printf("profile verification challenge failed for %s: %v", updatedUser.Email, challengeErr)
			writeJSON(w, http.StatusOK, authMessageResponse{
				OK:                   true,
				Authenticated:        true,
				User:                 toAuthUser(updatedUser),
				Email:                updatedUser.Email,
				VerificationRequired: updatedUser.VerificationRequired,
				Message:              "Profile updated. Verification delivery could not be issued automatically; request a new OTP from this page.",
			})
			return
		}
		resp.Authenticated = true
		resp.User = toAuthUser(updatedUser)
		resp.Email = updatedUser.Email
		resp.Message = "Profile updated. Enter the OTP sent to your new email address to re-verify the account."
		writeJSON(w, http.StatusOK, resp)
		return
	}

	writeJSON(w, http.StatusOK, authMessageResponse{
		OK:            true,
		Authenticated: true,
		User:          toAuthUser(updatedUser),
		Email:         updatedUser.Email,
		Message:       "Profile updated.",
	})
}

func (srv *Server) handleAuthVerifyEmail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	var req authVerifyEmailRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	email, err := store.NormalizeEmail(req.Email)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if !srv.enforceRateLimit(w, r, "auth-verify-email", email, rateLimitConfig{Limit: 6, Window: 10 * time.Minute}) {
		return
	}
	code := normalizeVerificationCode(req.Code)
	if code == "" {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "verification code is required"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	_ = srv.store.DeleteExpiredEmailVerificationCodes(ctx)
	user, err := srv.store.VerifyUserEmailCode(ctx, email, hashOpaqueToken(code))
	if err != nil {
		if errors.Is(err, store.ErrVerificationCode) {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "verification code is invalid or expired"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}

	if err := srv.issueSession(w, r, ctx, user); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	srv.recordAudit(r, 0, user, "auth.email_verified", auditTarget{}, nil)

	if srv.mailer != nil {
		welcomeCtx, welcomeCancel := context.WithTimeout(context.Background(), 8*time.Second)
		if err := srv.mailer.SendWelcome(welcomeCtx, mailer.WelcomeEmailInput{
			To:           user.Email,
			Name:         user.Name,
			DashboardURL: srv.buildDashboardURL(r, "alerts"),
		}); err != nil {
			log.Printf("welcome email failed for %s: %v", user.Email, err)
		}
		welcomeCancel()
	}

	writeJSON(w, http.StatusOK, authMessageResponse{
		OK:            true,
		Authenticated: true,
		User:          toAuthUser(user),
		Message:       "Email verified. Access granted.",
		Email:         user.Email,
	})
}

func (srv *Server) handleAuthResendVerification(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	var req authForgotPasswordRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	email, err := store.NormalizeEmail(req.Email)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if !srv.enforceRateLimit(w, r, "auth-resend-verification", email, rateLimitConfig{Limit: 3, Window: 10 * time.Minute}) {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	user, err := srv.store.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, store.ErrUserNotFound) {
			writeJSON(w, http.StatusOK, authMessageResponse{
				OK:      true,
				Message: "If an account is pending verification, a new OTP has been issued.",
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	if !user.VerificationRequired {
		writeJSON(w, http.StatusOK, authMessageResponse{
			OK:      true,
			Message: "This email is already verified. You can sign in now.",
			Email:   user.Email,
		})
		return
	}
	recent, err := srv.store.HasRecentEmailVerificationCode(ctx, user.ID, time.Now().Add(-verifyResendCooldown))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	if recent {
		writeJSON(w, http.StatusOK, authMessageResponse{
			OK:      true,
			Message: "A recent verification code is still active. Check your inbox before requesting another.",
			Email:   user.Email,
		})
		return
	}

	resp, err := srv.prepareVerificationChallenge(ctx, r, user)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, apiError{Error: err.Error()})
		return
	}
	resp.Message = "A fresh verification code has been sent."
	writeJSON(w, http.StatusOK, resp)
}

func (srv *Server) handleAuthForgotPassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	var req authForgotPasswordRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	email, err := store.NormalizeEmail(req.Email)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if !srv.enforceRateLimit(w, r, "auth-forgot-password", email, rateLimitConfig{Limit: 3, Window: 15 * time.Minute}) {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	_ = srv.store.DeleteExpiredPasswordResetTokens(ctx)

	resp := authMessageResponse{
		OK:      true,
		Message: "If an account exists, a reset link has been issued.",
	}

	user, err := srv.store.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, store.ErrUserNotFound) {
			writeJSON(w, http.StatusOK, resp)
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	recent, err := srv.store.HasRecentPasswordResetToken(ctx, user.ID, time.Now().Add(-resetIssueCooldown))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	if recent {
		writeJSON(w, http.StatusOK, resp)
		return
	}

	token, tokenHash, err := generatePasswordResetToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "failed to create reset token"})
		return
	}
	expiresAt := time.Now().Add(defaultResetTTL)
	if err := srv.store.CreatePasswordResetToken(ctx, user.ID, tokenHash, expiresAt); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}

	resetURL := srv.buildPasswordResetURL(r, token)
	if srv.mailer != nil {
		if err := srv.mailer.SendPasswordReset(ctx, mailer.PasswordResetInput{
			To:        user.Email,
			Name:      user.Name,
			ResetURL:  resetURL,
			ExpiresIn: defaultResetTTL,
		}); err != nil {
			if cleanupErr := srv.store.DeletePasswordResetToken(ctx, user.ID); cleanupErr != nil {
				log.Printf("password reset token cleanup failed for %s: %v", user.Email, cleanupErr)
			}
			log.Printf("password reset email failed for %s: %v", user.Email, err)
			writeJSON(w, http.StatusBadGateway, apiError{Error: "email delivery is temporarily unavailable"})
			return
		}
		resp.Message = "If an account exists, a reset link has been sent to the inbox."
	} else {
		log.Printf("password reset requested for %s: %s (expires %s)", user.Email, resetURL, expiresAt.UTC().Format(time.RFC3339))
		resp.Message = "If an account exists, a reset link has been issued locally."
	}
	if srv.mailer == nil && isLocalRequestHost(r.Host) {
		resp.PreviewURL = resetURL
	}
	writeJSON(w, http.StatusOK, resp)
}

func (srv *Server) handleAuthResetPassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	if srv.store == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "storage not available"})
		return
	}

	var req authResetPasswordRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	token := strings.TrimSpace(req.Token)
	if token == "" {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "reset token is required"})
		return
	}
	if err := validatePassword(req.Password); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if err := validatePasswordConfirmation(req.Password, req.ConfirmPassword); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "failed to hash password"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	if err := srv.store.DeleteExpiredPasswordResetTokens(ctx); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	if err := srv.store.ResetPasswordWithToken(ctx, hashOpaqueToken(token), string(passwordHash)); err != nil {
		if errors.Is(err, store.ErrResetTokenNotFound) {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "reset link is invalid or expired"})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}

	clearSessionCookie(w, r)
	writeJSON(w, http.StatusOK, authMessageResponse{
		OK:      true,
		Message: "Password updated. Sign in with your new password.",
	})
}

func (srv *Server) getOrCreateDemoUser(ctx context.Context) (store.User, error) {
	user, err := srv.store.GetUserByEmail(ctx, srv.demoEmail)
	if err == nil {
		return user, nil
	}
	if !errors.Is(err, store.ErrUserNotFound) {
		return store.User{}, err
	}

	passwordToken, _, genErr := generateOpaqueToken()
	if genErr != nil {
		return store.User{}, fmt.Errorf("failed to generate demo credentials")
	}
	passwordHash, hashErr := bcrypt.GenerateFromPassword([]byte(passwordToken), bcrypt.DefaultCost)
	if hashErr != nil {
		return store.User{}, fmt.Errorf("failed to prepare demo account")
	}
	return srv.store.CreateUser(ctx, srv.demoName, srv.demoEmail, string(passwordHash), false)
}

func (srv *Server) isDemoUser(user store.User) bool {
	if !srv.demoEnabled || srv.demoEmail == "" {
		return false
	}
	return strings.EqualFold(user.Email, srv.demoEmail)
}

func (srv *Server) buildPasswordResetURL(r *http.Request, token string) string {
	if srv.publicBaseURL != "" {
		return fmt.Sprintf("%s/reset-password?token=%s", srv.publicBaseURL, url.QueryEscape(token))
	}
	return fmt.Sprintf("%s://%s/reset-password?token=%s", requestScheme(r), requestHost(r), url.QueryEscape(token))
}

func normalizeVerificationCode(value string) string {
	value = strings.TrimSpace(value)
	value = strings.ReplaceAll(value, " ", "")
	return value
}

func (srv *Server) prepareVerificationChallenge(ctx context.Context, r *http.Request, user store.User) (authMessageResponse, error) {
	code, codeHash, err := generateVerificationCode()
	if err != nil {
		return authMessageResponse{}, fmt.Errorf("failed to generate verification code")
	}
	expiresAt := time.Now().Add(defaultVerifyCodeTTL)
	if err := srv.store.CreateEmailVerificationCode(ctx, user.ID, codeHash, expiresAt); err != nil {
		return authMessageResponse{}, err
	}

	resp := authMessageResponse{
		OK:                   true,
		Message:              "Account created. Enter the OTP sent to your email to activate access.",
		VerificationRequired: true,
		Email:                user.Email,
	}

	if srv.mailer != nil {
		if err := srv.mailer.SendVerificationOTP(ctx, mailer.VerificationOTPInput{
			To:        user.Email,
			Name:      user.Name,
			Code:      code,
			ExpiresIn: defaultVerifyCodeTTL,
		}); err != nil {
			if cleanupErr := srv.store.DeleteEmailVerificationCode(ctx, user.ID); cleanupErr != nil {
				log.Printf("verification code cleanup failed for %s: %v", user.Email, cleanupErr)
			}
			log.Printf("verification email failed for %s: %v", user.Email, err)
			resp.Message = "Account created, but email delivery failed. Request a new OTP to continue."
			return resp, nil
		}
		return resp, nil
	}

	log.Printf("email verification requested for %s: otp=%s (expires %s)", user.Email, code, expiresAt.UTC().Format(time.RFC3339))
	resp.PreviewCode = code
	resp.Message = "Account created. Enter the OTP below to activate access."
	return resp, nil
}

func normalizeDisplayName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("name is required")
	}
	if len(value) > maxNameLength {
		return "", fmt.Errorf("name must be %d characters or fewer", maxNameLength)
	}
	return value, nil
}

func normalizeSignupDisplayName(name, firstName, lastName string) (string, error) {
	name = strings.TrimSpace(name)
	if name != "" {
		return normalizeDisplayName(name)
	}

	firstName = strings.TrimSpace(firstName)
	lastName = strings.TrimSpace(lastName)
	if firstName == "" {
		return "", fmt.Errorf("first name is required")
	}
	if lastName == "" {
		return "", fmt.Errorf("last name is required")
	}
	return normalizeDisplayName(firstName + " " + lastName)
}

func validatePassword(value string) error {
	if len(value) < minPasswordLength {
		return fmt.Errorf("password must be at least %d characters", minPasswordLength)
	}
	if len(value) > maxPasswordLength {
		return fmt.Errorf("password must be %d characters or fewer", maxPasswordLength)
	}
	return nil
}

func validatePasswordConfirmation(password, confirmPassword string) error {
	confirmPassword = strings.TrimSpace(confirmPassword)
	if confirmPassword == "" {
		return nil
	}
	if password != confirmPassword {
		return fmt.Errorf("passwords do not match")
	}
	return nil
}

func toAuthUser(user store.User) *authUser {
	return &authUser{
		ID:              user.ID,
		Name:            user.Name,
		Email:           user.Email,
		EmailVerifiedAt: user.EmailVerifiedAt,
		CreatedAt:       user.CreatedAt,
	}
}

type authWorkspaceContextResponse struct {
	Workspace *authWorkspace `json:"workspace,omitempty"`
}
