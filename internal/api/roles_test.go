package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qnetward/internal/store"
)

// Viewers see a workspace but can't change it: reads (including reads sent as
// POST, like an export) work; creating, running, and probing are refused.
func TestViewersCanReadButNotChange(t *testing.T) {
	st := installTestStore(t)
	owner, _ := issueTestSession(t, st)
	viewer, viewerCookie := issueTestSession(t, st)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	invitation, err := st.CreateWorkspaceInvitationByUserID(ctx, owner.ID, viewer.Email, "viewer", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.AcceptWorkspaceInvitationByUserID(ctx, viewer.ID, invitation.ID); err != nil {
		t.Fatal(err)
	}
	teamID := testWorkspaceID(t, st, owner.ID)
	if err := st.SetSessionActiveWorkspace(ctx, hashSessionToken(viewerCookie.Value), viewer.ID, teamID); err != nil {
		t.Fatal(err)
	}

	call := func(method, path, body string) int {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(viewerCookie)
		rr := httptest.NewRecorder()
		testSrv.Handler().ServeHTTP(rr, req)
		return rr.Code
	}

	for _, read := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/monitors", ""},
		{http.MethodGet, "/api/history/recent-targets?limit=5", ""},
		{http.MethodPost, "/api/export/history", `{"format":"json"}`},
	} {
		if code := call(read.method, read.path, read.body); code == http.StatusForbidden || code == http.StatusUnauthorized {
			t.Errorf("%s %s: a viewer should be able to read, got %d", read.method, read.path, code)
		}
	}
	for _, write := range []struct{ method, path, body string }{
		{http.MethodPost, "/api/monitors", `{"name":"x","protocol":"tcpping","target":"example.com","port":443,"interval_seconds":300,"enabled":true}`},
		{http.MethodPost, "/api/tcpping", `{"host":"example.com","port":443,"count":1}`},
		{http.MethodPost, "/api/status-pages", `{"slug":"viewer-test","title":"x","published":false,"monitors":[]}`},
	} {
		if code := call(write.method, write.path, write.body); code != http.StatusForbidden {
			t.Errorf("%s %s: a viewer must be refused, got %d", write.method, write.path, code)
		}
	}
}

func TestRoleMayAct(t *testing.T) {
	for _, c := range []struct {
		role, scope, method string
		want                bool
	}{
		{"viewer", store.ScopeRead, http.MethodPost, true}, // a read sent as POST
		{"viewer", store.ScopeWrite, http.MethodPost, false},
		{"viewer", store.ScopeProbe, http.MethodPost, false},
		{"viewer", "", http.MethodGet, true},
		{"viewer", "", http.MethodDelete, false},
		{"member", store.ScopeWrite, http.MethodPost, true},
		{"admin", store.ScopeProbe, http.MethodPost, true},
	} {
		if got := roleMayAct(c.role, c.scope, c.method); got != c.want {
			t.Errorf("%s %s %s: got %v, want %v", c.role, c.scope, c.method, got, c.want)
		}
	}
}
