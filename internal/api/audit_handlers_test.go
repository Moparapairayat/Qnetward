package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Changes made through the API land in the workspace audit log, which only
// owners and admins can read; sign-in failures show in the account's own activity.
func TestAuditLogRecordsChangesForOwners(t *testing.T) {
	st := installTestStore(t)
	owner, ownerCookie := issueTestSession(t, st)
	member, memberCookie := issueTestSession(t, st)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	invitation, err := st.CreateWorkspaceInvitationByUserID(ctx, owner.ID, member.Email, "member", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("invite: %v", err)
	}
	if _, err := st.AcceptWorkspaceInvitationByUserID(ctx, member.ID, invitation.ID); err != nil {
		t.Fatalf("accept: %v", err)
	}
	if err := st.SetSessionActiveWorkspace(ctx, hashSessionToken(memberCookie.Value), member.ID, testWorkspaceID(t, st, owner.ID)); err != nil {
		t.Fatalf("switch: %v", err)
	}

	post := func(path, body string) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(ownerCookie)
		rr := httptest.NewRecorder()
		testSrv.Handler().ServeHTTP(rr, req)
		if rr.Code >= 300 {
			t.Fatalf("POST %s: %d %s", path, rr.Code, rr.Body.String())
		}
	}
	post("/api/monitors", `{"name":"Edge","protocol":"tcpping","target":"edge.example","port":443,"interval_seconds":300}`)
	post("/api/alerts/rules", `{"name":"Edge latency","protocol":"ping","target":"edge.example","latency_threshold_ms":100}`)

	read := func(cookie *http.Cookie, query string) (int, auditPage) {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/workspace/audit"+query, nil)
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		testSrv.handleWorkspaceAudit(rr, req)
		var page auditPage
		if rr.Code == http.StatusOK {
			if err := json.Unmarshal(rr.Body.Bytes(), &page); err != nil {
				t.Fatalf("decode audit page: %v", err)
			}
		}
		return rr.Code, page
	}

	code, page := read(ownerCookie, "")
	if code != http.StatusOK {
		t.Fatalf("owner read: expected 200, got %d", code)
	}
	actions := map[string]bool{}
	for _, e := range page.Events {
		actions[e.Action] = true
		if e.ActorEmail != owner.Email && e.Action != "member.joined" {
			t.Fatalf("unexpected actor on %s: %q", e.Action, e.ActorEmail)
		}
	}
	for _, want := range []string{"monitor.created", "alert_rule.created"} {
		if !actions[want] {
			t.Fatalf("expected %s in the audit log, got %v", want, actions)
		}
	}
	if code, page := read(ownerCookie, "?category=monitor"); code != http.StatusOK || len(page.Events) != 1 {
		t.Fatalf("category filter: %d, %d events", code, len(page.Events))
	}
	if code, _ := read(memberCookie, ""); code != http.StatusForbidden {
		t.Fatalf("member read: expected 403, got %d", code)
	}

	resetAuthRateLimiterForTest(t)
	login := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{"email":"`+owner.Email+`","password":"wrong-password"}`))
	login.Header.Set("Content-Type", "application/json")
	loginRR := httptest.NewRecorder()
	testSrv.handleAuthLogin(loginRR, login)
	if loginRR.Code != http.StatusUnauthorized {
		t.Fatalf("bad login: expected 401, got %d", loginRR.Code)
	}

	activity := httptest.NewRequest(http.MethodGet, "/api/account/activity", nil)
	activity.AddCookie(ownerCookie)
	activityRR := httptest.NewRecorder()
	testSrv.handleAccountActivity(activityRR, activity)
	var mine auditPage
	if err := json.Unmarshal(activityRR.Body.Bytes(), &mine); err != nil {
		t.Fatalf("decode activity: %v", err)
	}
	if len(mine.Events) == 0 || mine.Events[0].Action != "auth.login_failed" {
		t.Fatalf("expected the failed sign-in first in account activity, got %#v", mine.Events)
	}
}
