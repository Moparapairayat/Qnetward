package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"qnetward/internal/store"

	"golang.org/x/crypto/bcrypt"
)

func TestHandleAuthSessionReturnsUnauthenticatedWithoutCookie(t *testing.T) {
	installTestStore(t)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	rr := httptest.NewRecorder()

	testSrv.handleAuthSession(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	var resp authSessionResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Authenticated {
		t.Fatal("expected unauthenticated session response")
	}
}

func TestAuthDemoLoginFlow(t *testing.T) {
	installTestStore(t)
	originalEnabled := testSrv.demoEnabled
	originalName := testSrv.demoName
	originalEmail := testSrv.demoEmail
	originalCreatedAt := testSrv.demoCreatedAt
	t.Cleanup(func() {
		testSrv.demoEnabled = originalEnabled
		testSrv.demoName = originalName
		testSrv.demoEmail = originalEmail
		testSrv.demoCreatedAt = originalCreatedAt
	})

	testSrv.demoEnabled = true
	testSrv.demoName = "Contributor Demo"
	testSrv.demoEmail = "demo@qnetward.local"
	testSrv.demoCreatedAt = time.Now().UTC()

	req := httptest.NewRequest(http.MethodPost, "/api/auth/demo-login", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	testSrv.handleAuthDemoLogin(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	result := rr.Result()
	var sessionCookie *http.Cookie
	for _, cookie := range result.Cookies() {
		if cookie.Name == authCookieName {
			sessionCookie = cookie
			break
		}
	}
	if sessionCookie == nil || sessionCookie.Value == "" {
		t.Fatal("expected auth session cookie to be issued")
	}

	sessionReq := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	sessionReq.AddCookie(sessionCookie)
	sessionRR := httptest.NewRecorder()
	testSrv.handleAuthSession(sessionRR, sessionReq)

	if sessionRR.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", sessionRR.Code)
	}

	var sessionResp authSessionResponse
	if err := json.Unmarshal(sessionRR.Body.Bytes(), &sessionResp); err != nil {
		t.Fatalf("decode demo session response: %v", err)
	}
	if !sessionResp.Authenticated || sessionResp.Mode != "demo" || sessionResp.ReadOnly {
		t.Fatalf("unexpected demo session response: %#v", sessionResp)
	}
}

func TestAuthLogoutClearsDemoCookie(t *testing.T) {
	installTestStore(t)
	originalEnabled := testSrv.demoEnabled
	originalName := testSrv.demoName
	originalEmail := testSrv.demoEmail
	t.Cleanup(func() {
		testSrv.demoEnabled = originalEnabled
		testSrv.demoName = originalName
		testSrv.demoEmail = originalEmail
	})

	testSrv.demoEnabled = true
	testSrv.demoName = "Contributor Demo"
	testSrv.demoEmail = "demo-logout@qnetward.local"

	ctx := context.Background()
	user, err := testSrv.store.GetUserByEmail(ctx, testSrv.demoEmail)
	if err != nil {
		if !errors.Is(err, store.ErrUserNotFound) {
			t.Fatalf("load demo user: %v", err)
		}
		passwordHash, hashErr := bcrypt.GenerateFromPassword([]byte("temporary-demo-password"), bcrypt.DefaultCost)
		if hashErr != nil {
			t.Fatalf("hash demo password: %v", hashErr)
		}
		user, err = testSrv.store.CreateUser(ctx, testSrv.demoName, testSrv.demoEmail, string(passwordHash), false)
		if err != nil {
			t.Fatalf("create demo user: %v", err)
		}
	}
	token, tokenHash, err := generateSessionToken()
	if err != nil {
		t.Fatalf("generate demo session token: %v", err)
	}
	if err := testSrv.store.CreateSession(ctx, user.ID, tokenHash, time.Now().Add(time.Hour)); err != nil {
		t.Fatalf("create demo session: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/logout", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: authCookieName, Value: token})
	rr := httptest.NewRecorder()

	testSrv.handleAuthLogout(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	result := rr.Result()
	cleared := false
	for _, cookie := range result.Cookies() {
		if cookie.Name == authCookieName && cookie.MaxAge < 0 {
			cleared = true
			break
		}
	}
	if !cleared {
		t.Fatal("expected auth cookie to be cleared")
	}
}

func TestAuthProfileUpdateChangesName(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)

	req := httptest.NewRequest(http.MethodPatch, "/api/auth/profile", strings.NewReader(fmt.Sprintf(`{"name":"Updated Operator","email":"%s"}`, user.Email)))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()

	testSrv.handleAuthProfile(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp authMessageResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode profile update response: %v", err)
	}
	if resp.User == nil || resp.User.Name != "Updated Operator" {
		t.Fatalf("unexpected profile update response: %#v", resp)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	refreshed, err := st.GetUserBySessionToken(ctx, hashSessionToken(cookie.Value))
	if err != nil {
		t.Fatalf("load updated user: %v", err)
	}
	if refreshed.Name != "Updated Operator" {
		t.Fatalf("expected persisted name update, got %q", refreshed.Name)
	}
}

func TestAuthProfileUpdateEmailChangeIssuesVerification(t *testing.T) {
	st := installTestStore(t)
	_, cookie := issueTestSession(t, st)
	resetAuthRateLimiterForTest(t)

	nextEmail := fmt.Sprintf("updated_%d@example.com", time.Now().UnixNano())
	req := httptest.NewRequest(http.MethodPatch, "/api/auth/profile", strings.NewReader(fmt.Sprintf(`{"name":"Session Test User","email":"%s"}`, nextEmail)))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()

	testSrv.handleAuthProfile(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp authMessageResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode profile email update response: %v", err)
	}
	if resp.User == nil || resp.User.Email != nextEmail {
		t.Fatalf("unexpected profile email update response: %#v", resp)
	}
	if !resp.VerificationRequired {
		t.Fatalf("expected verification to be required after email change: %#v", resp)
	}
	if resp.PreviewCode == "" {
		t.Fatalf("expected preview verification code when mailer is disabled: %#v", resp)
	}
}

func TestAuthProfileUpdateRejectsDemoSession(t *testing.T) {
	installTestStore(t)
	originalEnabled := testSrv.demoEnabled
	originalName := testSrv.demoName
	originalEmail := testSrv.demoEmail
	originalCreatedAt := testSrv.demoCreatedAt
	t.Cleanup(func() {
		testSrv.demoEnabled = originalEnabled
		testSrv.demoName = originalName
		testSrv.demoEmail = originalEmail
		testSrv.demoCreatedAt = originalCreatedAt
	})

	testSrv.demoEnabled = true
	testSrv.demoName = "Contributor Demo"
	testSrv.demoEmail = "demo-profile@qnetward.local"
	testSrv.demoCreatedAt = time.Now().UTC()

	loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/demo-login", strings.NewReader(`{}`))
	loginReq.Header.Set("Content-Type", "application/json")
	loginRR := httptest.NewRecorder()
	testSrv.handleAuthDemoLogin(loginRR, loginReq)
	if loginRR.Code != http.StatusOK {
		t.Fatalf("expected demo login 200, got %d: %s", loginRR.Code, loginRR.Body.String())
	}
	cookie := extractAuthCookie(t, loginRR.Result())

	req := httptest.NewRequest(http.MethodPatch, "/api/auth/profile", strings.NewReader(`{"name":"Changed Demo","email":"demo-profile@qnetward.local"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()

	testSrv.handleAuthProfile(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "demo access cannot modify") {
		t.Fatalf("unexpected response body: %s", rr.Body.String())
	}
}

func TestAuthSignupLoginLogoutFlow(t *testing.T) {
	installTestStore(t)
	resetAuthRateLimiterForTest(t)

	email := fmt.Sprintf("auth_%d@example.com", time.Now().UnixNano())
	password := "S3curePass!"
	signupBody := fmt.Sprintf(`{"name":"Test User","email":"%s","password":"%s"}`, email, password)
	signupReq := httptest.NewRequest(http.MethodPost, "/api/auth/signup", strings.NewReader(signupBody))
	signupReq.Header.Set("Content-Type", "application/json")
	signupRR := httptest.NewRecorder()

	testSrv.handleAuthSignup(signupRR, signupReq)

	if signupRR.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", signupRR.Code, signupRR.Body.String())
	}
	var signupResp authMessageResponse
	if err := json.Unmarshal(signupRR.Body.Bytes(), &signupResp); err != nil {
		t.Fatalf("failed to decode signup response: %v", err)
	}
	if !signupResp.VerificationRequired || signupResp.Email != email || signupResp.PreviewCode == "" {
		t.Fatalf("unexpected signup response: %#v", signupResp)
	}

	loginBeforeVerifyReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(fmt.Sprintf(`{"email":"%s","password":"%s"}`, email, password)))
	loginBeforeVerifyReq.Header.Set("Content-Type", "application/json")
	loginBeforeVerifyRR := httptest.NewRecorder()
	testSrv.handleAuthLogin(loginBeforeVerifyRR, loginBeforeVerifyReq)
	if loginBeforeVerifyRR.Code != http.StatusForbidden {
		t.Fatalf("expected 403 before email verification, got %d: %s", loginBeforeVerifyRR.Code, loginBeforeVerifyRR.Body.String())
	}
	var loginBeforeVerifyResp authMessageResponse
	if err := json.Unmarshal(loginBeforeVerifyRR.Body.Bytes(), &loginBeforeVerifyResp); err != nil {
		t.Fatalf("failed to decode pre-verification login response: %v", err)
	}
	if !loginBeforeVerifyResp.VerificationRequired || loginBeforeVerifyResp.Email != email {
		t.Fatalf("unexpected pre-verification login response: %#v", loginBeforeVerifyResp)
	}

	resendReq := httptest.NewRequest(http.MethodPost, "/api/auth/resend-verification", strings.NewReader(fmt.Sprintf(`{"email":"%s"}`, email)))
	resendReq.Header.Set("Content-Type", "application/json")
	resendRR := httptest.NewRecorder()
	testSrv.handleAuthResendVerification(resendRR, resendReq)
	if resendRR.Code != http.StatusOK {
		t.Fatalf("expected 200 from resend verification, got %d: %s", resendRR.Code, resendRR.Body.String())
	}
	var resendResp authMessageResponse
	if err := json.Unmarshal(resendRR.Body.Bytes(), &resendResp); err != nil {
		t.Fatalf("failed to decode resend verification response: %v", err)
	}
	if resendResp.Email != email || !strings.Contains(strings.ToLower(resendResp.Message), "still active") {
		t.Fatalf("unexpected resend verification response: %#v", resendResp)
	}

	verifyBody := fmt.Sprintf(`{"email":"%s","code":"%s"}`, email, signupResp.PreviewCode)
	verifyReq := httptest.NewRequest(http.MethodPost, "/api/auth/verify-email", strings.NewReader(verifyBody))
	verifyReq.Header.Set("Content-Type", "application/json")
	verifyRR := httptest.NewRecorder()
	testSrv.handleAuthVerifyEmail(verifyRR, verifyReq)
	if verifyRR.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", verifyRR.Code, verifyRR.Body.String())
	}
	verifyCookie := extractAuthCookie(t, verifyRR.Result())

	loginBody := fmt.Sprintf(`{"email":"%s","password":"%s"}`, email, password)
	loginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	loginRR := httptest.NewRecorder()
	testSrv.handleAuthLogin(loginRR, loginReq)
	if loginRR.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", loginRR.Code, loginRR.Body.String())
	}
	loginCookie := extractAuthCookie(t, loginRR.Result())

	sessionReq := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	sessionReq.AddCookie(verifyCookie)
	sessionRR := httptest.NewRecorder()
	testSrv.handleAuthSession(sessionRR, sessionReq)
	if sessionRR.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", sessionRR.Code)
	}

	protectedReq := httptest.NewRequest(http.MethodPost, "/api/ping", strings.NewReader(`{"host":"example.com"}`))
	protectedReq.Header.Set("Content-Type", "application/json")
	protectedReq.AddCookie(loginCookie)
	protectedRR := httptest.NewRecorder()
	testSrv.handlePing(protectedRR, protectedReq)
	if protectedRR.Code == http.StatusUnauthorized {
		t.Fatal("expected authenticated request to pass auth gate")
	}

	unauthReq := httptest.NewRequest(http.MethodPost, "/api/ping", strings.NewReader(`{"host":"example.com"}`))
	unauthReq.Header.Set("Content-Type", "application/json")
	unauthRR := httptest.NewRecorder()
	testSrv.handlePing(unauthRR, unauthReq)
	if unauthRR.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", unauthRR.Code)
	}
}

func TestAuthSignupAcceptsFirstAndLastName(t *testing.T) {
	installTestStore(t)
	resetAuthRateLimiterForTest(t)

	email := fmt.Sprintf("names_%d@example.com", time.Now().UnixNano())
	body := fmt.Sprintf(`{"first_name":"Test","last_name":"Operator","email":"%s","password":"S3curePass!","confirm_password":"S3curePass!"}`, email)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/signup", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	testSrv.handleAuthSignup(rr, req)

	if rr.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestAuthRejectsMismatchedConfirmPassword(t *testing.T) {
	installTestStore(t)
	resetAuthRateLimiterForTest(t)

	email := fmt.Sprintf("mismatch_%d@example.com", time.Now().UnixNano())
	signupReq := httptest.NewRequest(http.MethodPost, "/api/auth/signup", strings.NewReader(fmt.Sprintf(`{"name":"Mismatch User","email":"%s","password":"S3curePass!","confirm_password":"DifferentPass!"}`, email)))
	signupReq.Header.Set("Content-Type", "application/json")
	signupRR := httptest.NewRecorder()
	testSrv.handleAuthSignup(signupRR, signupReq)
	if signupRR.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for signup mismatch, got %d: %s", signupRR.Code, signupRR.Body.String())
	}

	resetReq := httptest.NewRequest(http.MethodPost, "/api/auth/reset-password", strings.NewReader(`{"token":"abc","password":"S3curePass!","confirm_password":"DifferentPass!"}`))
	resetReq.Header.Set("Content-Type", "application/json")
	resetRR := httptest.NewRecorder()
	testSrv.handleAuthResetPassword(resetRR, resetReq)
	if resetRR.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for reset mismatch, got %d: %s", resetRR.Code, resetRR.Body.String())
	}
}

func TestAuthForgotAndResetPasswordFlow(t *testing.T) {
	st := installTestStore(t)
	resetAuthRateLimiterForTest(t)

	email := fmt.Sprintf("reset_%d@example.com", time.Now().UnixNano())
	password := "S3curePass!"
	newPassword := "An0therPass!"
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if _, err := st.CreateUser(ctx, "Reset User", email, string(hash), false); err != nil {
		t.Fatalf("create verified user: %v", err)
	}

	forgotReq := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", strings.NewReader(fmt.Sprintf(`{"email":"%s"}`, email)))
	forgotReq.Host = "127.0.0.1:8080"
	forgotReq.Header.Set("Content-Type", "application/json")
	forgotRR := httptest.NewRecorder()
	testSrv.handleAuthForgotPassword(forgotRR, forgotReq)
	if forgotRR.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", forgotRR.Code, forgotRR.Body.String())
	}

	var forgotResp authMessageResponse
	if err := json.Unmarshal(forgotRR.Body.Bytes(), &forgotResp); err != nil {
		t.Fatalf("decode forgot response: %v", err)
	}
	if forgotResp.PreviewURL == "" {
		t.Fatal("expected preview reset URL for local host")
	}
	resetURL, err := url.Parse(forgotResp.PreviewURL)
	if err != nil {
		t.Fatalf("parse preview URL: %v", err)
	}
	token := resetURL.Query().Get("token")
	if token == "" {
		t.Fatal("expected reset token in preview URL")
	}

	resetReq := httptest.NewRequest(http.MethodPost, "/api/auth/reset-password", strings.NewReader(fmt.Sprintf(`{"token":"%s","password":"%s"}`, token, newPassword)))
	resetReq.Header.Set("Content-Type", "application/json")
	resetRR := httptest.NewRecorder()
	testSrv.handleAuthResetPassword(resetRR, resetReq)
	if resetRR.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resetRR.Code, resetRR.Body.String())
	}

	oldLoginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(fmt.Sprintf(`{"email":"%s","password":"%s"}`, email, password)))
	oldLoginReq.Header.Set("Content-Type", "application/json")
	oldLoginRR := httptest.NewRecorder()
	testSrv.handleAuthLogin(oldLoginRR, oldLoginReq)
	if oldLoginRR.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for old password, got %d", oldLoginRR.Code)
	}

	newLoginReq := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(fmt.Sprintf(`{"email":"%s","password":"%s"}`, email, newPassword)))
	newLoginReq.Header.Set("Content-Type", "application/json")
	newLoginRR := httptest.NewRecorder()
	testSrv.handleAuthLogin(newLoginRR, newLoginReq)
	if newLoginRR.Code != http.StatusOK {
		t.Fatalf("expected 200 for new password, got %d: %s", newLoginRR.Code, newLoginRR.Body.String())
	}
}

func TestHandleAuthLoginRateLimited(t *testing.T) {
	st := installTestStore(t)
	resetAuthRateLimiterForTest(t)

	email := fmt.Sprintf("loginlimit_%d@example.com", time.Now().UnixNano())
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	hash, err := bcrypt.GenerateFromPassword([]byte("CorrectHorseBatteryStaple"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if _, err := st.CreateUser(ctx, "Rate Limited User", email, string(hash), false); err != nil {
		t.Fatalf("create user: %v", err)
	}

	body := fmt.Sprintf(`{"email":"%s","password":"wrong-password"}`, email)
	for attempt := 1; attempt <= 8; attempt++ {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		testSrv.handleAuthLogin(rr, req)
		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: expected 401, got %d: %s", attempt, rr.Code, rr.Body.String())
		}
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	testSrv.handleAuthLogin(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d: %s", rr.Code, rr.Body.String())
	}
}

func TestHandleAuthResendVerificationUsesCooldown(t *testing.T) {
	st := installTestStore(t)
	resetAuthRateLimiterForTest(t)

	email := fmt.Sprintf("verifycooldown_%d@example.com", time.Now().UnixNano())
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	user, err := st.CreateUser(ctx, "Pending User", email, "test-password-hash", true)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := st.CreateEmailVerificationCode(ctx, user.ID, hashOpaqueToken("123456"), time.Now().Add(defaultVerifyCodeTTL)); err != nil {
		t.Fatalf("seed verification code: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/resend-verification", strings.NewReader(fmt.Sprintf(`{"email":"%s"}`, email)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	testSrv.handleAuthResendVerification(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp authMessageResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !strings.Contains(strings.ToLower(resp.Message), "still active") {
		t.Fatalf("unexpected response: %#v", resp)
	}
}

func TestPrepareVerificationChallengeCleansUpCodeWhenEmailSendFails(t *testing.T) {
	st := installTestStore(t)
	installFailingTestMailer(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	user, err := st.CreateUser(ctx, "Mailer Failure User", fmt.Sprintf("verify_fail_%d@example.com", time.Now().UnixNano()), "hash", true)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/signup", nil)
	resp, err := testSrv.prepareVerificationChallenge(ctx, req, user)
	if err != nil {
		t.Fatalf("prepareVerificationChallenge returned error: %v", err)
	}
	if !strings.Contains(strings.ToLower(resp.Message), "email delivery failed") {
		t.Fatalf("unexpected response: %#v", resp)
	}

	recent, err := st.HasRecentEmailVerificationCode(ctx, user.ID, time.Now().Add(-defaultVerifyCodeTTL))
	if err != nil {
		t.Fatalf("HasRecentEmailVerificationCode returned error: %v", err)
	}
	if recent {
		t.Fatal("expected verification code to be cleaned up after send failure")
	}
}

func TestHandleAuthForgotPasswordCleansUpTokenWhenEmailSendFails(t *testing.T) {
	st := installTestStore(t)
	installFailingTestMailer(t)
	resetAuthRateLimiterForTest(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	email := fmt.Sprintf("reset_fail_%d@example.com", time.Now().UnixNano())
	hash, err := bcrypt.GenerateFromPassword([]byte("CorrectHorseBatteryStaple"), bcrypt.DefaultCost)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	user, err := st.CreateUser(ctx, "Reset Failure User", email, string(hash), false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/forgot-password", strings.NewReader(fmt.Sprintf(`{"email":"%s"}`, email)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	testSrv.handleAuthForgotPassword(rr, req)

	if rr.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", rr.Code, rr.Body.String())
	}

	recent, err := st.HasRecentPasswordResetToken(ctx, user.ID, time.Now().Add(-defaultResetTTL))
	if err != nil {
		t.Fatalf("HasRecentPasswordResetToken returned error: %v", err)
	}
	if recent {
		t.Fatal("expected password reset token to be cleaned up after send failure")
	}
}

// With full access on, the demo account acts as an ordinary owner: its
// session isn't marked demo, and it can do what the demo normally can't.
func TestDemoFullAccessLiftsRestrictions(t *testing.T) {
	st := installTestStore(t)
	enabled, name, email, full, workspace := testSrv.demoEnabled, testSrv.demoName, testSrv.demoEmail, testSrv.demoFullAccess, testSrv.demoWorkspace
	t.Cleanup(func() {
		testSrv.demoEnabled, testSrv.demoName, testSrv.demoEmail, testSrv.demoFullAccess, testSrv.demoWorkspace = enabled, name, email, full, workspace
	})
	testSrv.demoWorkspace = "Kestrel Labs"
	testSrv.demoEnabled = true
	testSrv.demoName = "Contributor Demo"
	testSrv.demoEmail = fmt.Sprintf("demo-full-%d@qnetward.local", time.Now().UnixNano())

	login := func() *http.Cookie {
		rr := httptest.NewRecorder()
		testSrv.handleAuthDemoLogin(rr, httptest.NewRequest(http.MethodPost, "/api/auth/demo-login", strings.NewReader(`{}`)))
		if rr.Code != http.StatusOK {
			t.Fatalf("demo login: expected 200, got %d: %s", rr.Code, rr.Body.String())
		}
		for _, c := range rr.Result().Cookies() {
			if c.Name == authCookieName {
				return c
			}
		}
		t.Fatal("no session cookie")
		return nil
	}
	createKey := func(cookie *http.Cookie) int {
		req := httptest.NewRequest(http.MethodPost, "/api/workspace/api-keys", strings.NewReader(`{"name":"demo","scopes":["read"],"expires_in_days":30}`))
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		testSrv.handleWorkspaceAPIKeys(rr, req)
		return rr.Code
	}

	testSrv.demoFullAccess = false
	if code := createKey(login()); code != http.StatusForbidden {
		t.Fatalf("restricted demo: expected 403, got %d", code)
	}

	testSrv.demoFullAccess = true
	cookie := login()
	if code := createKey(cookie); code != http.StatusCreated {
		t.Fatalf("full-access demo: expected 201, got %d", code)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/session", nil)
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()
	testSrv.handleAuthSession(rr, req)
	var session authSessionResponse
	_ = json.Unmarshal(rr.Body.Bytes(), &session)
	if session.Mode != "authenticated" {
		t.Fatalf("expected the session to be an ordinary one, got mode %q", session.Mode)
	}

	// The generated "<name> Workspace" becomes the demo workspace's company name.
	user, err := st.GetUserByEmail(t.Context(), testSrv.demoEmail)
	if err != nil {
		t.Fatalf("demo user: %v", err)
	}
	ws, err := st.GetWorkspaceContextByUserID(t.Context(), user.ID)
	if err != nil || ws.Name != testSrv.demoWorkspace {
		t.Fatalf("expected the demo workspace to be named %q, got %q (err %v)", testSrv.demoWorkspace, ws.Name, err)
	}
}
