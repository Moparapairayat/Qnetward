package api

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"

	qrcode "github.com/skip2/go-qrcode"

	"qnetward/internal/platform/totp"
	"qnetward/internal/store"
)

const (
	mfaIssuer         = "Qnetward"
	mfaChallengeTTL   = 5 * time.Minute
	recoveryCodeCount = 10
)

type mfaStatusResponse struct {
	Enabled      bool       `json:"enabled"`
	EnabledAt    *time.Time `json:"enabled_at,omitempty"`
	RecoveryLeft int        `json:"recovery_codes_left"`
}

type mfaSetupResponse struct {
	Secret     string `json:"secret"`
	OTPAuthURL string `json:"otpauth_url"`
	QRCode     string `json:"qr_code"`
}

type mfaCodeRequest struct {
	Password string `json:"password,omitempty"`
	Code     string `json:"code"`
}

type mfaRecoveryResponse struct {
	RecoveryCodes []string `json:"recovery_codes"`
}

type mfaLoginRequest struct {
	Token string `json:"mfa_token"`
	Code  string `json:"code"`
}

type mfaChallengeResponse struct {
	MFARequired bool   `json:"mfa_required"`
	MFAToken    string `json:"mfa_token"`
	Message     string `json:"message"`
}

// handleAccountMFA reports whether two-factor sign-in is on.
func (srv *Server) handleAccountMFA(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireAccountUser(w, r, false)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	state, _, err := srv.store.GetMFA(ctx, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, mfaStatusResponse{Enabled: state.Enabled, EnabledAt: state.EnabledAt, RecoveryLeft: state.RecoveryLeft})
}

// handleAccountMFASetup creates a new secret after re-checking the password
// and returns it with a QR code. Nothing changes at sign-in until a code from
// it is confirmed.
func (srv *Server) handleAccountMFASetup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireAccountUser(w, r, true)
	if !ok {
		return
	}
	var req mfaCodeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if !srv.checkPassword(w, r, ctx, user, req.Password, "account-mfa") {
		return
	}
	secret, err := totp.NewSecret()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not create a secret"})
		return
	}
	sealed, err := srv.secrets.Seal(secret)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not store the secret"})
		return
	}
	if err := srv.store.StartMFASetup(ctx, user.ID, sealed); err != nil {
		if errors.Is(err, store.ErrMFAAlreadyEnabled) {
			writeJSON(w, http.StatusConflict, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	uri := totp.URI(mfaIssuer, user.Email, secret)
	png, err := qrcode.Encode(uri, qrcode.Medium, 256)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not draw the QR code"})
		return
	}
	writeJSON(w, http.StatusOK, mfaSetupResponse{
		Secret:     secret,
		OTPAuthURL: uri,
		QRCode:     "data:image/png;base64," + base64.StdEncoding.EncodeToString(png),
	})
}

// handleAccountMFAEnable confirms the first code and turns two-factor sign-in
// on, returning recovery codes once.
func (srv *Server) handleAccountMFAEnable(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireAccountUser(w, r, true)
	if !ok {
		return
	}
	var req mfaCodeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if !srv.enforceRateLimit(w, r, "account-mfa-enable", user.Email, rateLimitConfig{Limit: 10, Window: 15 * time.Minute}) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	state, found, err := srv.store.GetMFA(ctx, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	if !found || state.Enabled {
		writeJSON(w, http.StatusConflict, apiError{Error: "start setup first"})
		return
	}
	secret, err := srv.secrets.Open(state.SecretEnc)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	step, valid := totp.Validate(secret, req.Code, time.Now())
	if !valid {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "that code didn't match; check the time on your phone and try the newest code"})
		return
	}
	codes, hashes, err := newRecoveryCodes()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not create recovery codes"})
		return
	}
	if err := srv.store.EnableMFA(ctx, user.ID, step, hashes); err != nil {
		writeJSON(w, http.StatusConflict, apiError{Error: err.Error()})
		return
	}
	srv.recordAudit(r, 0, user, "account.mfa_enabled", auditTarget{}, nil)
	writeJSON(w, http.StatusOK, mfaRecoveryResponse{RecoveryCodes: codes})
}

// handleAccountMFADisable turns two-factor sign-in off. It needs the password
// and a current code or a recovery code.
func (srv *Server) handleAccountMFADisable(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireAccountUser(w, r, true)
	if !ok {
		return
	}
	var req mfaCodeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if !srv.checkPassword(w, r, ctx, user, req.Password, "account-mfa") {
		return
	}
	if _, ok := srv.checkSecondFactor(w, r, ctx, user, req.Code); !ok {
		return
	}
	if err := srv.store.DisableMFA(ctx, user.ID); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	srv.recordAudit(r, 0, user, "account.mfa_disabled", auditTarget{}, nil)
	writeJSON(w, http.StatusOK, authMessageResponse{OK: true, Message: "Two-factor sign-in is off."})
}

// handleAccountMFARecovery replaces the recovery codes. Old ones stop working.
func (srv *Server) handleAccountMFARecovery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireAccountUser(w, r, true)
	if !ok {
		return
	}
	var req mfaCodeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if !srv.checkPassword(w, r, ctx, user, req.Password, "account-mfa") {
		return
	}
	if _, ok := srv.checkSecondFactor(w, r, ctx, user, req.Code); !ok {
		return
	}
	codes, hashes, err := newRecoveryCodes()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not create recovery codes"})
		return
	}
	if err := srv.store.ReplaceRecoveryCodes(ctx, user.ID, hashes); err != nil {
		writeJSON(w, http.StatusConflict, apiError{Error: err.Error()})
		return
	}
	srv.recordAudit(r, 0, user, "account.recovery_codes_replaced", auditTarget{}, nil)
	writeJSON(w, http.StatusOK, mfaRecoveryResponse{RecoveryCodes: codes})
}

// handleAuthMFA finishes a sign-in that needs a second factor.
func (srv *Server) handleAuthMFA(w http.ResponseWriter, r *http.Request) {
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
	var req mfaLoginRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	if !srv.enforceRateLimit(w, r, "auth-mfa", "", rateLimitConfig{Limit: 20, Window: 15 * time.Minute}) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	tokenHash := hashOpaqueToken(strings.TrimSpace(req.Token))
	user, err := srv.store.TakeMFAChallenge(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, store.ErrMFAChallengeFailed) {
			writeJSON(w, http.StatusUnauthorized, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	method, ok := srv.checkSecondFactor(w, r, ctx, user, req.Code)
	if !ok {
		return
	}
	_ = srv.store.FinishMFAChallenge(ctx, tokenHash)
	if err := srv.issueSession(w, r, ctx, user); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	srv.recordAudit(r, 0, user, "auth.login", auditTarget{}, map[string]any{"mfa": method})
	writeJSON(w, http.StatusOK, authSessionResponse{Authenticated: true, User: toAuthUser(user)})
}

// startMFAChallenge answers a correct password for an account with
// two-factor sign-in on: no session yet, only a token for the second step.
func (srv *Server) startMFAChallenge(w http.ResponseWriter, ctx context.Context, user store.User) {
	token, tokenHash, err := generateOpaqueToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not start the second sign-in step"})
		return
	}
	if err := srv.store.CreateMFAChallenge(ctx, user.ID, tokenHash, time.Now().Add(mfaChallengeTTL)); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, mfaChallengeResponse{MFARequired: true, MFAToken: token, Message: "Enter the code from your authenticator app."})
}

// checkSecondFactor accepts a current TOTP code or an unused recovery code
// and writes the error response when neither matches. It returns which one
// was used.
func (srv *Server) checkSecondFactor(w http.ResponseWriter, r *http.Request, ctx context.Context, user store.User, code string) (string, bool) {
	state, found, err := srv.store.GetMFA(ctx, user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return "", false
	}
	if !found || !state.Enabled {
		writeJSON(w, http.StatusConflict, apiError{Error: store.ErrMFANotSetUp.Error()})
		return "", false
	}
	code = strings.TrimSpace(code)
	if normalized := normalizeRecoveryCode(code); len(normalized) == 10 {
		used, err := srv.store.UseRecoveryCode(ctx, user.ID, hashOpaqueToken(normalized))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return "", false
		}
		if used {
			srv.recordAudit(r, 0, user, "auth.recovery_code_used", auditTarget{}, map[string]any{"left": state.RecoveryLeft - 1})
			return "recovery_code", true
		}
	} else if secret, err := srv.secrets.Open(state.SecretEnc); err == nil {
		if step, valid := totp.Validate(secret, code, time.Now()); valid {
			fresh, err := srv.store.UseMFAStep(ctx, user.ID, step)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
				return "", false
			}
			if fresh {
				return "totp", true
			}
		}
	} else {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return "", false
	}
	srv.recordAudit(r, 0, user, "auth.mfa_failed", auditTarget{}, nil)
	writeJSON(w, http.StatusUnauthorized, apiError{Error: "that code didn't work; use the newest code from your app or a recovery code"})
	return "", false
}

// newRecoveryCodes returns ten codes like "k7f2q-9xw3m" and their hashes.
func newRecoveryCodes() ([]string, []string, error) {
	const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
	// Bytes at or above this are skipped, so every letter is equally likely.
	limit := byte(256 - 256%len(alphabet))
	codes := make([]string, recoveryCodeCount)
	hashes := make([]string, recoveryCodeCount)
	one := make([]byte, 1)
	for i := range codes {
		raw := make([]byte, 0, 10)
		for len(raw) < 10 {
			if _, err := rand.Read(one); err != nil {
				return nil, nil, err
			}
			if one[0] < limit {
				raw = append(raw, alphabet[int(one[0])%len(alphabet)])
			}
		}
		codes[i] = string(raw[:5]) + "-" + string(raw[5:])
		hashes[i] = hashOpaqueToken(string(raw))
	}
	return codes, hashes, nil
}

func normalizeRecoveryCode(code string) string {
	return strings.ToLower(strings.NewReplacer("-", "", " ", "").Replace(code))
}
