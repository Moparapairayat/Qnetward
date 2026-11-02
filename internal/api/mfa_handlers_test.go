package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"qnetward/internal/platform/totp"
)

// Turning on two-factor sign-in makes login ask for a code; codes can't be
// replayed, recovery codes work once, and both password and code are needed
// to turn it off again.
func TestMFAEnrollAndSignIn(t *testing.T) {
	st := installTestStore(t)
	resetAuthRateLimiterForTest(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	const password = "correct horse battery"
	hash, _ := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	email := fmt.Sprintf("mfa_%d@example.com", time.Now().UnixNano())
	user, err := st.CreateUser(ctx, "MFA User", email, string(hash), false)
	if err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1", nil)
	rr := httptest.NewRecorder()
	if err := testSrv.issueSession(rr, req, ctx, user); err != nil {
		t.Fatalf("issueSession: %v", err)
	}
	cookie := extractAuthCookie(t, rr.Result())

	post := func(path, body string, withCookie bool) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if withCookie {
			req.AddCookie(cookie)
		}
		rr := httptest.NewRecorder()
		testSrv.Handler().ServeHTTP(rr, req)
		return rr
	}

	if rr := post("/api/account/mfa/setup", `{"password":"wrong"}`, true); rr.Code == http.StatusOK {
		t.Fatal("setup should need the right password")
	}
	rr = post("/api/account/mfa/setup", fmt.Sprintf(`{"password":%q}`, password), true)
	if rr.Code != http.StatusOK {
		t.Fatalf("setup: %d %s", rr.Code, rr.Body.String())
	}
	var setup mfaSetupResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &setup)
	if setup.Secret == "" || !strings.HasPrefix(setup.QRCode, "data:image/png;base64,") || !strings.Contains(setup.OTPAuthURL, email) {
		t.Fatalf("unexpected setup response: %+v", setup)
	}

	// Login is unchanged until the first code is confirmed.
	login := func() *httptest.ResponseRecorder {
		return post("/api/auth/login", fmt.Sprintf(`{"email":%q,"password":%q}`, email, password), false)
	}
	if rr := login(); rr.Code != http.StatusOK || strings.Contains(rr.Body.String(), "mfa_required") {
		t.Fatalf("login before confirming: %d %s", rr.Code, rr.Body.String())
	}

	now := time.Now()
	code, _ := totp.Code(setup.Secret, totp.Step(now))
	rr = post("/api/account/mfa/enable", fmt.Sprintf(`{"code":%q}`, code), true)
	if rr.Code != http.StatusOK {
		t.Fatalf("enable: %d %s", rr.Code, rr.Body.String())
	}
	var recovery mfaRecoveryResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &recovery)
	if len(recovery.RecoveryCodes) != recoveryCodeCount || len(recovery.RecoveryCodes[0]) != 11 {
		t.Fatalf("unexpected recovery codes: %v", recovery.RecoveryCodes)
	}

	challenge := func() string {
		t.Helper()
		rr := login()
		var resp mfaChallengeResponse
		_ = json.Unmarshal(rr.Body.Bytes(), &resp)
		if rr.Code != http.StatusOK || !resp.MFARequired || resp.MFAToken == "" || len(rr.Result().Cookies()) != 0 {
			t.Fatalf("expected a challenge and no session, got %d %s", rr.Code, rr.Body.String())
		}
		return resp.MFAToken
	}
	second := func(token, code string) *httptest.ResponseRecorder {
		return post("/api/auth/mfa", fmt.Sprintf(`{"mfa_token":%q,"code":%q}`, token, code), false)
	}

	token := challenge()
	if rr := second(token, "000000"); rr.Code != http.StatusUnauthorized {
		t.Fatalf("wrong code: expected 401, got %d", rr.Code)
	}
	if rr := second(token, code); rr.Code != http.StatusUnauthorized {
		t.Fatalf("replayed code: expected 401, got %d", rr.Code)
	}
	next, _ := totp.Code(setup.Secret, totp.Step(now)+1)
	if rr := second(token, next); rr.Code != http.StatusOK || len(rr.Result().Cookies()) == 0 {
		t.Fatalf("fresh code: expected a session, got %d %s", rr.Code, rr.Body.String())
	}
	if rr := second(token, next); rr.Code != http.StatusUnauthorized {
		t.Fatalf("a finished challenge can't be reused, got %d", rr.Code)
	}

	token = challenge()
	if rr := second(token, strings.ToUpper(recovery.RecoveryCodes[0])); rr.Code != http.StatusOK {
		t.Fatalf("recovery code: %d %s", rr.Code, rr.Body.String())
	}
	token = challenge()
	if rr := second(token, recovery.RecoveryCodes[0]); rr.Code != http.StatusUnauthorized {
		t.Fatalf("used recovery code: expected 401, got %d", rr.Code)
	}

	if rr := post("/api/account/mfa/disable", fmt.Sprintf(`{"password":%q,"code":"000000"}`, password), true); rr.Code != http.StatusUnauthorized {
		t.Fatalf("disable with a wrong code: expected 401, got %d", rr.Code)
	}
	if rr := post("/api/account/mfa/disable", fmt.Sprintf(`{"password":%q,"code":%q}`, password, recovery.RecoveryCodes[1]), true); rr.Code != http.StatusOK {
		t.Fatalf("disable: %d %s", rr.Code, rr.Body.String())
	}
	if rr := login(); strings.Contains(rr.Body.String(), "mfa_required") {
		t.Fatal("login should be one step again after turning two-factor off")
	}
}
