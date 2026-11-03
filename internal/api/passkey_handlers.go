package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"qnetward/internal/store"
)

const passkeyCeremonyTTL = 5 * time.Minute

// newWebAuthn builds the relying party from the public URL. WebAuthn binds
// credentials to a domain name, so an IP address (or no URL) turns passkeys
// off; use http://localhost in development.
func newWebAuthn(publicBaseURL string) *webauthn.WebAuthn {
	u, err := url.Parse(strings.TrimSpace(publicBaseURL))
	if err != nil || u.Hostname() == "" || net.ParseIP(u.Hostname()) != nil {
		return nil
	}
	origin := u.Scheme + "://" + u.Host
	w, err := webauthn.New(&webauthn.Config{
		RPDisplayName: "Qnetward",
		RPID:          u.Hostname(),
		RPOrigins:     []string{origin},
	})
	if err != nil {
		log.Printf("passkeys disabled: %v", err)
		return nil
	}
	return w
}

// webauthnUser adapts an account and its stored passkeys to the library.
type webauthnUser struct {
	user   store.User
	handle []byte
	creds  []webauthn.Credential
}

func (u webauthnUser) WebAuthnID() []byte                         { return u.handle }
func (u webauthnUser) WebAuthnName() string                       { return u.user.Email }
func (u webauthnUser) WebAuthnDisplayName() string                { return u.user.Name }
func (u webauthnUser) WebAuthnCredentials() []webauthn.Credential { return u.creds }

func (srv *Server) loadWebAuthnUser(ctx context.Context, user store.User) (webauthnUser, error) {
	handle, err := srv.store.WebAuthnHandle(ctx, user.ID)
	if err != nil {
		return webauthnUser{}, err
	}
	keys, err := srv.store.ListPasskeys(ctx, user.ID)
	if err != nil {
		return webauthnUser{}, err
	}
	u := webauthnUser{user: user, handle: handle}
	for _, k := range keys {
		var c webauthn.Credential
		if err := json.Unmarshal(k.Credential, &c); err != nil {
			return webauthnUser{}, fmt.Errorf("stored passkey %d: %w", k.ID, err)
		}
		u.creds = append(u.creds, c)
	}
	return u, nil
}

func (srv *Server) requirePasskeys(w http.ResponseWriter) bool {
	if srv.webauthn == nil {
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "passkeys need the console on a domain name (QNETWARD_PUBLIC_BASE_URL)"})
		return false
	}
	return true
}

func (srv *Server) saveCeremony(ctx context.Context, userID int64, kind string, session *webauthn.SessionData) (string, error) {
	data, err := json.Marshal(session)
	if err != nil {
		return "", err
	}
	token, tokenHash, err := generateOpaqueToken()
	if err != nil {
		return "", err
	}
	return token, srv.store.SaveWebAuthnChallenge(ctx, tokenHash, userID, kind, data, time.Now().Add(passkeyCeremonyTTL))
}

func (srv *Server) takeCeremony(ctx context.Context, token, kind string) (int64, webauthn.SessionData, error) {
	userID, data, err := srv.store.TakeWebAuthnChallenge(ctx, hashOpaqueToken(token), kind)
	if err != nil {
		return 0, webauthn.SessionData{}, err
	}
	var session webauthn.SessionData
	err = json.Unmarshal(data, &session)
	return userID, session, err
}

type passkeyBeginResponse struct {
	Token   string `json:"token"`
	Options any    `json:"options"`
}

// handleAccountPasskeys lists (GET) or removes (DELETE ?id=) the user's passkeys.
func (srv *Server) handleAccountPasskeys(w http.ResponseWriter, r *http.Request) {
	user, ok := srv.requireAccountUser(w, r, r.Method != http.MethodGet)
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	switch r.Method {
	case http.MethodGet:
		keys, err := srv.store.ListPasskeys(ctx, user.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"passkeys": keys, "available": srv.webauthn != nil})
	case http.MethodDelete:
		id, err := strconv.ParseInt(r.URL.Query().Get("id"), 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "valid passkey id is required"})
			return
		}
		key, err := srv.store.DeletePasskey(ctx, user.ID, id)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, store.ErrPasskeyNotFound) {
				status = http.StatusNotFound
			}
			writeJSON(w, status, apiError{Error: err.Error()})
			return
		}
		srv.recordAudit(r, 0, user, "account.passkey_removed", idTarget("passkey", key.ID, key.Name), nil)
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
	}
}

// handlePasskeyRegisterBegin starts adding a passkey. Adding a way to sign in
// needs the password, like turning on two-factor sign-in.
func (srv *Server) handlePasskeyRegisterBegin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireAccountUser(w, r, true)
	if !ok || !srv.requirePasskeys(w) {
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	if !srv.checkPassword(w, r, ctx, user, req.Password, "account-passkey") {
		return
	}
	wu, err := srv.loadWebAuthnUser(ctx, user)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	exclude := make([]protocol.CredentialDescriptor, 0, len(wu.creds))
	for _, c := range wu.creds {
		exclude = append(exclude, c.Descriptor())
	}
	options, session, err := srv.webauthn.BeginRegistration(wu,
		webauthn.WithResidentKeyRequirement(protocol.ResidentKeyRequirementRequired),
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementRequired,
			UserVerification: protocol.VerificationRequired,
		}),
		webauthn.WithExclusions(exclude),
	)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	token, err := srv.saveCeremony(ctx, user.ID, "register", session)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, passkeyBeginResponse{Token: token, Options: options})
}

// handlePasskeyRegisterFinish stores the new passkey. The body is the
// browser's credential; token and name come in the query string.
func (srv *Server) handlePasskeyRegisterFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	user, ok := srv.requireAccountUser(w, r, true)
	if !ok || !srv.requirePasskeys(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	ownerID, session, err := srv.takeCeremony(ctx, r.URL.Query().Get("token"), "register")
	if err != nil || ownerID != user.ID {
		writeJSON(w, http.StatusBadRequest, apiError{Error: store.ErrChallengeNotFound.Error()})
		return
	}
	wu, err := srv.loadWebAuthnUser(ctx, user)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	credential, err := srv.webauthn.FinishRegistration(wu, session, r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "the passkey couldn't be verified: " + protocolMessage(err)})
		return
	}
	record, err := json.Marshal(credential)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	key, err := srv.store.AddPasskey(ctx, user.ID, credential.ID, r.URL.Query().Get("name"), record)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}
	srv.recordAudit(r, 0, user, "account.passkey_added", idTarget("passkey", key.ID, key.Name), nil)
	writeJSON(w, http.StatusCreated, key)
}

// handlePasskeyLoginBegin starts a passwordless sign-in. No email is asked
// for: the browser offers the passkeys it holds for this site.
func (srv *Server) handlePasskeyLoginBegin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	if srv.store == nil || !srv.requirePasskeys(w) {
		return
	}
	if !srv.enforceRateLimit(w, r, "auth-passkey", "", rateLimitConfig{Limit: 30, Window: 15 * time.Minute}) {
		return
	}
	options, session, err := srv.webauthn.BeginDiscoverableLogin(webauthn.WithUserVerification(protocol.VerificationRequired))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	token, err := srv.saveCeremony(ctx, 0, "login", session)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, passkeyBeginResponse{Token: token, Options: options})
}

// handlePasskeyLoginFinish verifies the assertion and signs in. A passkey
// with user verification is already two factors, so no TOTP step follows.
func (srv *Server) handlePasskeyLoginFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.isAllowedRequestOrigin(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "forbidden origin"})
		return
	}
	if srv.store == nil || !srv.requirePasskeys(w) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	_, session, err := srv.takeCeremony(ctx, r.URL.Query().Get("token"), "login")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: store.ErrChallengeNotFound.Error()})
		return
	}

	var signedIn store.User
	found, credential, err := srv.webauthn.FinishPasskeyLogin(func(_, userHandle []byte) (webauthn.User, error) {
		user, err := srv.store.UserByWebAuthnHandle(ctx, userHandle)
		if err != nil {
			return nil, err
		}
		signedIn = user
		return srv.loadWebAuthnUser(ctx, user)
	}, session, r)
	if err != nil || found == nil {
		writeJSON(w, http.StatusUnauthorized, apiError{Error: "that passkey isn't registered here, or couldn't be verified"})
		return
	}
	if credential.Authenticator.CloneWarning {
		srv.recordAudit(r, 0, signedIn, "auth.passkey_clone_warning", auditTarget{}, nil)
		writeJSON(w, http.StatusUnauthorized, apiError{Error: "this passkey looks like a copy of another; sign in another way and remove it"})
		return
	}
	if record, err := json.Marshal(credential); err == nil {
		_ = srv.store.RecordPasskeyUse(ctx, credential.ID, record)
	}
	if signedIn.VerificationRequired {
		writeJSON(w, http.StatusForbidden, apiError{Error: "verify your email address first"})
		return
	}
	if err := srv.issueSession(w, r, ctx, signedIn); err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: err.Error()})
		return
	}
	srv.recordAudit(r, 0, signedIn, "auth.login", auditTarget{}, map[string]any{"method": "passkey"})
	writeJSON(w, http.StatusOK, authSessionResponse{Authenticated: true, User: toAuthUser(signedIn)})
}

// protocolMessage pulls the readable detail out of a WebAuthn error.
func protocolMessage(err error) string {
	var pe *protocol.Error
	if errors.As(err, &pe) && pe.Details != "" {
		return pe.Details
	}
	return err.Error()
}
