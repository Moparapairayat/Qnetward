package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"

	"qnetward/internal/store"
)

// newPasswordUser creates a user with a known password and signs them in.
func newPasswordUser(t *testing.T, st *store.Store, password string) (store.User, *http.Cookie) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	user, err := st.CreateUser(ctx, "Account Tester", fmt.Sprintf("account_%d@example.com", time.Now().UnixNano()), string(hash), false)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/auth/login", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0")
	rr := httptest.NewRecorder()
	if err := testSrv.issueSession(rr, req, ctx, user); err != nil {
		t.Fatalf("issue session: %v", err)
	}
	return user, extractAuthCookie(t, rr.Result())
}

func accountRequest(t *testing.T, method, path, body string, cookie *http.Cookie, handler http.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

func TestAccountPasswordChange(t *testing.T) {
	st := installTestStore(t)
	resetAuthRateLimiterForTest(t)
	user, cookie := newPasswordUser(t, st, "old-password-1")
	_, other := newPasswordUserSession(t, st, user)

	if rr := accountRequest(t, http.MethodPost, "/api/account/password", `{"current_password":"wrong","new_password":"new-password-2"}`, cookie, testSrv.handleAccountPassword); rr.Code != http.StatusForbidden {
		t.Fatalf("wrong current password: expected 403, got %d", rr.Code)
	}
	if rr := accountRequest(t, http.MethodPost, "/api/account/password", `{"current_password":"old-password-1","new_password":"short"}`, cookie, testSrv.handleAccountPassword); rr.Code != http.StatusBadRequest {
		t.Fatalf("short password: expected 400, got %d", rr.Code)
	}
	rr := accountRequest(t, http.MethodPost, "/api/account/password", `{"current_password":"old-password-1","new_password":"new-password-2"}`, cookie, testSrv.handleAccountPassword)
	if rr.Code != http.StatusOK {
		t.Fatalf("change: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	ctx := context.Background()
	hash, err := st.GetUserPasswordHash(ctx, user.ID)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte("new-password-2")) != nil {
		t.Fatalf("expected the new password to be stored (err %v)", err)
	}
	if _, err := st.GetUserBySessionToken(ctx, hashSessionToken(cookie.Value)); err != nil {
		t.Fatalf("current session should survive: %v", err)
	}
	if _, err := st.GetUserBySessionToken(ctx, hashSessionToken(other.Value)); err == nil {
		t.Fatal("other session should be signed out")
	}
}

// newPasswordUserSession opens a second session for an existing user.
func newPasswordUserSession(t *testing.T, st *store.Store, user store.User) (store.User, *http.Cookie) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/auth/login", nil)
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Mac OS X) Safari/605.1")
	rr := httptest.NewRecorder()
	if err := testSrv.issueSession(rr, req, context.Background(), user); err != nil {
		t.Fatalf("issue second session: %v", err)
	}
	return user, extractAuthCookie(t, rr.Result())
}

func TestAccountSessionsListAndRevoke(t *testing.T) {
	st := installTestStore(t)
	user, cookie := newPasswordUser(t, st, "password-123")
	newPasswordUserSession(t, st, user)
	newPasswordUserSession(t, st, user)

	list := func() []store.SessionInfo {
		t.Helper()
		rr := accountRequest(t, http.MethodGet, "/api/account/sessions", "", cookie, testSrv.handleAccountSessions)
		if rr.Code != http.StatusOK {
			t.Fatalf("list: expected 200, got %d", rr.Code)
		}
		var resp sessionsResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return resp.Sessions
	}

	sessions := list()
	if len(sessions) != 3 {
		t.Fatalf("expected 3 sessions, got %d", len(sessions))
	}
	current := 0
	var otherID int64
	for _, s := range sessions {
		if s.Current {
			current++
			if !strings.Contains(s.UserAgent, "Chrome") {
				t.Errorf("current session user agent = %q", s.UserAgent)
			}
		} else {
			otherID = s.ID
		}
	}
	if current != 1 {
		t.Fatalf("expected exactly one current session, got %d", current)
	}

	if rr := accountRequest(t, http.MethodDelete, "/api/account/sessions", fmt.Sprintf(`{"id":%d}`, otherID), cookie, testSrv.handleAccountSessions); rr.Code != http.StatusOK {
		t.Fatalf("revoke one: expected 200, got %d", rr.Code)
	}
	if rr := accountRequest(t, http.MethodDelete, "/api/account/sessions", `{"id":999999999}`, cookie, testSrv.handleAccountSessions); rr.Code != http.StatusNotFound {
		t.Fatalf("revoke unknown: expected 404, got %d", rr.Code)
	}
	if rr := accountRequest(t, http.MethodDelete, "/api/account/sessions", `{"others":true}`, cookie, testSrv.handleAccountSessions); rr.Code != http.StatusOK {
		t.Fatalf("revoke others: expected 200, got %d", rr.Code)
	}
	if left := list(); len(left) != 1 || !left[0].Current {
		t.Fatalf("expected only the current session to remain, got %#v", left)
	}
}

func TestAccountDelete(t *testing.T) {
	st := installTestStore(t)
	resetAuthRateLimiterForTest(t)
	user, cookie := newPasswordUser(t, st, "password-123")

	if rr := accountRequest(t, http.MethodDelete, "/api/account", `{"password":"password-123","email":"someone@else.com"}`, cookie, testSrv.handleAccountDelete); rr.Code != http.StatusBadRequest {
		t.Fatalf("wrong confirmation email: expected 400, got %d", rr.Code)
	}
	if rr := accountRequest(t, http.MethodDelete, "/api/account", fmt.Sprintf(`{"password":"nope","email":"%s"}`, user.Email), cookie, testSrv.handleAccountDelete); rr.Code != http.StatusForbidden {
		t.Fatalf("wrong password: expected 403, got %d", rr.Code)
	}
	rr := accountRequest(t, http.MethodDelete, "/api/account", fmt.Sprintf(`{"password":"password-123","email":"%s"}`, strings.ToUpper(user.Email)), cookie, testSrv.handleAccountDelete)
	if rr.Code != http.StatusOK {
		t.Fatalf("delete: expected 200, got %d: %s", rr.Code, rr.Body.String())
	}
	if _, err := st.GetUserByEmail(context.Background(), user.Email); err == nil {
		t.Fatal("user should be gone")
	}
}

func TestAccountDeleteRefusesSharedWorkspace(t *testing.T) {
	st := installTestStore(t)
	resetAuthRateLimiterForTest(t)
	owner, cookie := newPasswordUser(t, st, "password-123")
	member, _ := newPasswordUser(t, st, "password-456")

	ctx := context.Background()
	invitation, err := st.CreateWorkspaceInvitationByUserID(ctx, owner.ID, member.Email, "member", time.Now().Add(72*time.Hour))
	if err != nil {
		t.Fatalf("invite: %v", err)
	}
	if _, err := st.AcceptWorkspaceInvitationByUserID(ctx, member.ID, invitation.ID); err != nil {
		t.Fatalf("accept: %v", err)
	}

	rr := accountRequest(t, http.MethodDelete, "/api/account", fmt.Sprintf(`{"password":"password-123","email":"%s"}`, owner.Email), cookie, testSrv.handleAccountDelete)
	if rr.Code != http.StatusConflict {
		t.Fatalf("expected 409 while owning a shared workspace, got %d: %s", rr.Code, rr.Body.String())
	}
}

// Without object storage the picture is kept in the database: it uploads,
// serves with its type, replaces in place, and goes away on removal.
func TestAccountAvatarStoredInDatabase(t *testing.T) {
	st := installTestStore(t)
	user, cookie := newPasswordUser(t, st, "password-123")

	upload := func(data []byte) *httptest.ResponseRecorder {
		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		part, _ := mw.CreateFormFile("file", "a.png")
		_, _ = part.Write(data)
		_ = mw.Close()
		req := httptest.NewRequest(http.MethodPost, "/api/account/avatar", &body)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		testSrv.handleAccountAvatar(rr, req)
		return rr
	}
	fetch := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/avatars/%d", user.ID), nil)
		req.SetPathValue("id", strconv.FormatInt(user.ID, 10))
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		testSrv.handleAvatarImage(rr, req)
		return rr
	}

	png := []byte("\x89PNG\r\n\x1a\nfirst")
	first := upload(png)
	if first.Code != http.StatusOK || !strings.Contains(first.Body.String(), "/api/avatars/") {
		t.Fatalf("upload: got %d: %s", first.Code, first.Body.String())
	}
	if rr := fetch(); rr.Code != http.StatusOK || rr.Header().Get("Content-Type") != "image/png" || !bytes.Equal(rr.Body.Bytes(), png) {
		t.Fatalf("serve: got %d %q", rr.Code, rr.Header().Get("Content-Type"))
	}

	second := upload([]byte("\x89PNG\r\n\x1a\nsecond"))
	if second.Body.String() == first.Body.String() {
		t.Fatal("a new picture should get a new URL, so caches refresh")
	}
	if rr := fetch(); !strings.HasSuffix(rr.Body.String(), "second") {
		t.Fatal("expected the replacement picture")
	}

	if rr := upload([]byte("<svg onload=alert(1)>")); rr.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("svg: expected 415, got %d", rr.Code)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/account/avatar", nil)
	req.AddCookie(cookie)
	testSrv.handleAccountAvatar(httptest.NewRecorder(), req)
	if rr := fetch(); rr.Code != http.StatusNotFound {
		t.Fatalf("after removal: expected 404, got %d", rr.Code)
	}
}

func TestAvatarURLChangesWithKey(t *testing.T) {
	if avatarURL(7, "") != "" {
		t.Fatal("no key should mean no URL")
	}
	a, b := avatarURL(7, "avatars/7/a.png"), avatarURL(7, "avatars/7/b.png")
	if a == b || !strings.HasPrefix(a, "/api/avatars/7?v=") {
		t.Fatalf("unexpected avatar URLs %q and %q", a, b)
	}
}
