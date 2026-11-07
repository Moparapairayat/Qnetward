package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// OAuthProvider is an OAuth 2.0 / OpenID Connect provider's endpoints and our
// client credentials for it.
type OAuthProvider struct {
	Name         string
	ClientID     string
	ClientSecret string
	AuthURL      string
	TokenURL     string
	UserInfoURL  string
	Scopes       string
}

// GoogleOAuth returns Google's endpoints with the given client credentials.
func GoogleOAuth(clientID, clientSecret string) OAuthProvider {
	return OAuthProvider{
		Name:         "google",
		ClientID:     strings.TrimSpace(clientID),
		ClientSecret: strings.TrimSpace(clientSecret),
		AuthURL:      "https://accounts.google.com/o/oauth2/v2/auth",
		TokenURL:     "https://oauth2.googleapis.com/token",
		UserInfoURL:  "https://openidconnect.googleapis.com/v1/userinfo",
		Scopes:       "openid email profile",
	}
}

func (p OAuthProvider) configured() bool {
	return p.ClientID != "" && p.ClientSecret != ""
}

const (
	oauthCookieName = "qnetward_oauth"
	oauthStateTTL   = 10 * time.Minute
)

type providersResponse struct {
	Google   bool `json:"google"`
	Passkeys bool `json:"passkeys"`
}

// handleAuthProviders tells the sign-in page which other sign-in methods work.
// passkeysEnabled reports whether passkey sign-in can work: WebAuthn needs a
// domain name to bind keys to.
func (srv *Server) passkeysEnabled() bool {
	return srv.webauthn != nil
}

func (srv *Server) handleAuthProviders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	writeJSON(w, http.StatusOK, providersResponse{Google: srv.google.configured(), Passkeys: srv.passkeysEnabled()})
}

// oauthRedirectURI is where the provider sends the browser back. It must be
// registered with the provider exactly as built here.
func (srv *Server) oauthRedirectURI(r *http.Request, provider string) string {
	base := srv.publicBaseURL
	if base == "" {
		base = fmt.Sprintf("%s://%s", requestScheme(r), requestHost(r))
	}
	return base + "/api/auth/" + provider + "/callback"
}

func (srv *Server) appURL(r *http.Request, path string) string {
	base := srv.publicBaseURL
	if base == "" {
		base = fmt.Sprintf("%s://%s", requestScheme(r), requestHost(r))
	}
	return base + path
}

// handleGoogleStart sends the browser to Google with a fresh state and a
// PKCE challenge. Both are kept in a short-lived cookie for the callback.
func (srv *Server) handleGoogleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "method not allowed"})
		return
	}
	if !srv.google.configured() || srv.store == nil {
		http.Redirect(w, r, srv.appURL(r, "/login?error=google_unavailable"), http.StatusFound)
		return
	}
	state, err := randomURLToken(24)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not start sign-in"})
		return
	}
	verifier, err := randomURLToken(48)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "could not start sign-in"})
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     oauthCookieName,
		Value:    state + "." + verifier,
		Path:     "/api/auth/",
		HttpOnly: true,
		// Lax, so the cookie comes back on the provider's top-level redirect.
		SameSite: http.SameSiteLaxMode,
		Secure:   requestIsSecure(r),
		MaxAge:   int(oauthStateTTL.Seconds()),
	})
	challenge := sha256.Sum256([]byte(verifier))
	q := url.Values{}
	q.Set("client_id", srv.google.ClientID)
	q.Set("redirect_uri", srv.oauthRedirectURI(r, srv.google.Name))
	q.Set("response_type", "code")
	q.Set("scope", srv.google.Scopes)
	q.Set("state", state)
	q.Set("code_challenge", base64.RawURLEncoding.EncodeToString(challenge[:]))
	q.Set("code_challenge_method", "S256")
	q.Set("prompt", "select_account")
	http.Redirect(w, r, srv.google.AuthURL+"?"+q.Encode(), http.StatusFound)
}

type oauthUserInfo struct {
	Subject       string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

// handleGoogleCallback finishes the Google flow: it checks the state, trades
// the code for a token, reads the verified email, and signs the browser in.
func (srv *Server) handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	fail := func(code string) {
		clearOAuthCookie(w, r)
		http.Redirect(w, r, srv.appURL(r, "/login?error="+code), http.StatusFound)
	}
	if r.Method != http.MethodGet || !srv.google.configured() || srv.store == nil {
		fail("google_unavailable")
		return
	}
	query := r.URL.Query()
	if query.Get("error") != "" {
		fail("google_cancelled")
		return
	}
	cookie, err := r.Cookie(oauthCookieName)
	state, verifier, ok := strings.Cut(func() string {
		if err != nil {
			return ""
		}
		return cookie.Value
	}(), ".")
	if !ok || state == "" || query.Get("state") != state {
		fail("google_state")
		return
	}
	clearOAuthCookie(w, r)

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	info, err := srv.exchangeOAuthCode(ctx, srv.google, query.Get("code"), verifier, srv.oauthRedirectURI(r, srv.google.Name))
	if err != nil {
		log.Printf("google sign-in failed: %v", err)
		fail("google_failed")
		return
	}
	if !info.EmailVerified || info.Email == "" {
		fail("google_unverified")
		return
	}

	// Accounts created this way get a random password nobody knows; the owner
	// can set one later with "Forgot your password?".
	placeholder, _ := randomURLToken(32)
	hash, err := bcrypt.GenerateFromPassword([]byte(placeholder), bcrypt.DefaultCost)
	if err != nil {
		fail("google_failed")
		return
	}
	user, created, err := srv.store.IdentitySignIn(ctx, srv.google.Name, info.Subject, info.Email, info.Name, string(hash))
	if err != nil {
		log.Printf("google sign-in for %s failed: %v", info.Email, err)
		fail("google_failed")
		return
	}
	if created {
		srv.recordAudit(r, 0, user, "auth.signup", auditTarget{}, map[string]any{"provider": "google"})
	}
	if info.Picture != "" {
		srv.background.Add(1)
		go func() {
			defer srv.background.Done()
			srv.importProviderPicture(user.ID, info.Picture)
		}()
	}

	if mfa, _, err := srv.store.GetMFA(ctx, user.ID); err != nil {
		fail("google_failed")
		return
	} else if mfa.Enabled {
		token, tokenHash, err := generateOpaqueToken()
		if err != nil || srv.store.CreateMFAChallenge(ctx, user.ID, tokenHash, time.Now().Add(mfaChallengeTTL)) != nil {
			fail("google_failed")
			return
		}
		// A fragment never reaches a server or a Referer header.
		http.Redirect(w, r, srv.appURL(r, "/login#mfa="+url.QueryEscape(token)), http.StatusFound)
		return
	}

	if err := srv.issueSession(w, r, ctx, user); err != nil {
		fail("google_failed")
		return
	}
	srv.recordAudit(r, 0, user, "auth.login", auditTarget{}, map[string]any{"provider": "google"})
	http.Redirect(w, r, srv.appURL(r, "/overview"), http.StatusFound)
}

func (srv *Server) exchangeOAuthCode(ctx context.Context, p OAuthProvider, code, verifier, redirectURI string) (oauthUserInfo, error) {
	if code == "" {
		return oauthUserInfo{}, errors.New("missing authorization code")
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("client_id", p.ClientID)
	form.Set("client_secret", p.ClientSecret)
	form.Set("code_verifier", verifier)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return oauthUserInfo{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if err := doJSON(req, &token); err != nil {
		return oauthUserInfo{}, fmt.Errorf("token exchange: %w", err)
	}
	if token.AccessToken == "" {
		return oauthUserInfo{}, errors.New("token exchange returned no access token")
	}

	req, err = http.NewRequestWithContext(ctx, http.MethodGet, p.UserInfoURL, nil)
	if err != nil {
		return oauthUserInfo{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token.AccessToken)
	var info oauthUserInfo
	if err := doJSON(req, &info); err != nil {
		return oauthUserInfo{}, fmt.Errorf("userinfo: %w", err)
	}
	if info.Subject == "" {
		return oauthUserInfo{}, errors.New("userinfo returned no subject")
	}
	return info, nil
}

func doJSON(req *http.Request, out any) error {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode >= 300 {
		return fmt.Errorf("%s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	return json.Unmarshal(body, out)
}

func clearOAuthCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: oauthCookieName, Value: "", Path: "/api/auth/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: requestIsSecure(r), MaxAge: -1})
}

func randomURLToken(bytes int) (string, error) {
	buf := make([]byte, bytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// importProviderPicture copies a Google profile picture into the user's
// avatar, unless they already have one. It runs after sign-in, so a slow or
// failed download never holds up the redirect.
func (srv *Server) importProviderPicture(userID int64, pictureURL string) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if key, err := srv.store.GetUserAvatarKey(ctx, userID); err != nil || key != "" {
		return
	}
	u, err := url.Parse(pictureURL)
	if err != nil || (u.Scheme != "https" && !srv.allowInsecurePictureHost(u)) || !(strings.HasSuffix(u.Hostname(), ".googleusercontent.com") || srv.allowInsecurePictureHost(u)) {
		return
	}
	// Google serves 96 px by default; ask for the size the UI uses.
	u.Path = strings.Replace(u.Path, "=s96-c", "=s256-c", 1)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return
	}
	resp, err := srv.notifySender().Client.Do(req)
	if err != nil {
		log.Printf("fetching the Google picture for user %d failed: %v", userID, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxAvatarBytes+1))
	if err != nil || len(data) > maxAvatarBytes {
		return
	}
	contentType := http.DetectContentType(data)
	ext, ok := avatarTypes[contentType]
	if !ok {
		return
	}
	if _, err := srv.setAvatar(ctx, userID, contentType, ext, data); err != nil {
		log.Printf("saving the Google picture for user %d failed: %v", userID, err)
	}
}

// allowInsecurePictureHost lets tests serve the picture from a local server.
func (srv *Server) allowInsecurePictureHost(u *url.URL) bool {
	return srv.pictureTestHost != "" && u.Host == srv.pictureTestHost
}
