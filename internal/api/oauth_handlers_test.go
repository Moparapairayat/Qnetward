package api

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeOAuth stands in for Google: it checks the PKCE verifier against the
// challenge from the authorization request and returns a chosen profile.
type fakeOAuth struct {
	mu        sync.Mutex
	challenge string
	profile   oauthUserInfo
}

func (f *fakeOAuth) server(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		sum := sha256.Sum256([]byte(r.PostForm.Get("code_verifier")))
		f.mu.Lock()
		ok := base64.RawURLEncoding.EncodeToString(sum[:]) == f.challenge && r.PostForm.Get("code") == "good-code"
		f.mu.Unlock()
		if !ok {
			http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "fake-access"})
	})
	mux.HandleFunc("/photo=s256-c", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("\x89PNG\r\n\x1a\ngoogle-photo"))
	})
	mux.HandleFunc("/userinfo", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer fake-access" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		f.mu.Lock()
		defer f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(f.profile)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestGoogleSignInCreatesLinksAndRejects(t *testing.T) {
	st := installTestStore(t)
	fake := &fakeOAuth{}
	provider := fake.server(t)

	previous, previousBase, previousPictureHost := testSrv.google, testSrv.publicBaseURL, testSrv.pictureTestHost
	testSrv.google = OAuthProvider{Name: "google", ClientID: "client", ClientSecret: "secret", AuthURL: provider.URL + "/auth", TokenURL: provider.URL + "/token", UserInfoURL: provider.URL + "/userinfo", Scopes: "openid email"}
	testSrv.publicBaseURL = "http://web.test"
	testSrv.pictureTestHost = strings.TrimPrefix(provider.URL, "http://")
	t.Cleanup(func() { testSrv.google, testSrv.publicBaseURL, testSrv.pictureTestHost = previous, previousBase, previousPictureHost })

	// signIn runs start and callback, returning the final redirect and cookies.
	signIn := func(profile oauthUserInfo, tamperState bool) (string, []*http.Cookie) {
		t.Helper()
		fake.mu.Lock()
		fake.profile = profile
		fake.mu.Unlock()

		start := httptest.NewRecorder()
		testSrv.handleGoogleStart(start, httptest.NewRequest(http.MethodGet, "/api/auth/google/start", nil))
		if start.Code != http.StatusFound {
			t.Fatalf("start: expected 302, got %d", start.Code)
		}
		auth, _ := url.Parse(start.Header().Get("Location"))
		q := auth.Query()
		if q.Get("redirect_uri") != "http://web.test/api/auth/google/callback" || q.Get("code_challenge_method") != "S256" {
			t.Fatalf("unexpected authorization request: %s", auth)
		}
		fake.mu.Lock()
		fake.challenge = q.Get("code_challenge")
		fake.mu.Unlock()

		state := q.Get("state")
		if tamperState {
			state = "forged"
		}
		cb := httptest.NewRequest(http.MethodGet, "/api/auth/google/callback?code=good-code&state="+url.QueryEscape(state), nil)
		for _, c := range start.Result().Cookies() {
			cb.AddCookie(c)
		}
		rr := httptest.NewRecorder()
		testSrv.handleGoogleCallback(rr, cb)
		if rr.Code != http.StatusFound {
			t.Fatalf("callback: expected 302, got %d", rr.Code)
		}
		return rr.Header().Get("Location"), rr.Result().Cookies()
	}
	hasSession := func(cookies []*http.Cookie) bool {
		for _, c := range cookies {
			if c.Name == authCookieName && c.Value != "" {
				return true
			}
		}
		return false
	}

	// Subjects are unique per run: the test database keeps identities from earlier runs.
	run := time.Now().UnixNano()
	sub := func(n int) string { return fmt.Sprintf("sub-%d-%d", run, n) }
	email := fmt.Sprintf("google_%d@example.com", run)
	location, cookies := signIn(oauthUserInfo{Subject: sub(1), Email: email, EmailVerified: true, Name: "Grace Google", Picture: provider.URL + "/photo=s96-c"}, false)
	if location != "http://web.test/overview" || !hasSession(cookies) {
		t.Fatalf("new account: redirected to %q, session %v", location, hasSession(cookies))
	}
	user, err := st.GetUserByEmail(t.Context(), email)
	if err != nil || user.Name != "Grace Google" || user.VerificationRequired {
		t.Fatalf("expected a verified account named from Google, got %#v (err %v)", user, err)
	}
	// The Google picture becomes the avatar, fetched at 256 px, after the redirect.
	waitFor(t, 10*time.Second, func() bool {
		_, data, err := st.GetUserAvatarData(t.Context(), user.ID)
		return err == nil && strings.HasSuffix(string(data), "google-photo")
	})

	// The same Google account signs into the same user, even with a new email.
	if location, _ := signIn(oauthUserInfo{Subject: sub(1), Email: email, EmailVerified: true}, false); location != "http://web.test/overview" {
		t.Fatalf("returning user: redirected to %q", location)
	}

	// An existing password account with the same verified email gets linked.
	existing, _ := issueTestSession(t, st)
	signIn(oauthUserInfo{Subject: sub(2), Email: existing.Email, EmailVerified: true}, false)
	providers, err := st.ListUserIdentityProviders(t.Context(), existing.ID)
	if err != nil || len(providers) != 1 || providers[0] != "google" {
		t.Fatalf("expected the existing account to be linked, got %v (err %v)", providers, err)
	}

	if location, cookies := signIn(oauthUserInfo{Subject: sub(3), Email: "x@example.com", EmailVerified: false}, false); !strings.HasSuffix(location, "error=google_unverified") || hasSession(cookies) {
		t.Fatalf("unverified email: redirected to %q", location)
	}
	if location, cookies := signIn(oauthUserInfo{Subject: sub(1), Email: email, EmailVerified: true}, true); !strings.HasSuffix(location, "error=google_state") || hasSession(cookies) {
		t.Fatalf("forged state: redirected to %q", location)
	}
}
