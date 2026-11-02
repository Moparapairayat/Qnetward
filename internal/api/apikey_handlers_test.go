package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qnetward/internal/store"
)

// An API key works for the endpoints its scopes allow, in its own workspace,
// shows up in the audit log by name, and stops working once revoked.
func TestAPIKeysAuthenticateWithScopes(t *testing.T) {
	st := installTestStore(t)
	owner, cookie := issueTestSession(t, st)

	call := func(method, path, body string, auth func(*http.Request)) *httptest.ResponseRecorder {
		t.Helper()
		var reader *strings.Reader
		if body != "" {
			reader = strings.NewReader(body)
		} else {
			reader = strings.NewReader("")
		}
		req := httptest.NewRequest(method, path, reader)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		auth(req)
		rr := httptest.NewRecorder()
		testSrv.Handler().ServeHTTP(rr, req)
		return rr
	}
	withCookie := func(req *http.Request) { req.AddCookie(cookie) }
	bearer := func(token string) func(*http.Request) {
		return func(req *http.Request) { req.Header.Set("Authorization", "Bearer "+token) }
	}
	create := func(name string, scopes ...string) (store.APIKey, string) {
		t.Helper()
		quoted := make([]string, len(scopes))
		for i, s := range scopes {
			quoted[i] = fmt.Sprintf("%q", s)
		}
		rr := call(http.MethodPost, "/api/workspace/api-keys", fmt.Sprintf(`{"name":%q,"scopes":[%s],"expires_in_days":30}`, name, strings.Join(quoted, ",")), withCookie)
		if rr.Code != http.StatusCreated {
			t.Fatalf("create key: %d %s", rr.Code, rr.Body.String())
		}
		var resp apiKeyCreateResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode key: %v", err)
		}
		if !strings.HasPrefix(resp.Token, apiKeyPrefix) || !strings.HasPrefix(resp.Token, resp.Key.Prefix) || resp.Key.ExpiresAt == nil {
			t.Fatalf("unexpected key: %#v", resp)
		}
		return resp.Key, resp.Token
	}

	readKey, readToken := create("dashboards", "read")
	_, writeToken := create("terraform", "read", "write")

	if rr := call(http.MethodGet, "/api/monitors", "", bearer(readToken)); rr.Code != http.StatusOK {
		t.Fatalf("read key listing monitors: %d %s", rr.Code, rr.Body.String())
	}
	monitor := `{"name":"From CI","protocol":"tcpping","target":"ci.example","port":443,"interval_seconds":300}`
	if rr := call(http.MethodPost, "/api/monitors", monitor, bearer(readToken)); rr.Code != http.StatusForbidden {
		t.Fatalf("read key creating a monitor: expected 403, got %d", rr.Code)
	}
	if rr := call(http.MethodPost, "/api/monitors", monitor, bearer(writeToken)); rr.Code != http.StatusCreated {
		t.Fatalf("write key creating a monitor: %d %s", rr.Code, rr.Body.String())
	}
	if rr := call(http.MethodPost, "/api/tcpping", `{"host":"127.0.0.1","port":1,"count":1}`, bearer(writeToken)); rr.Code != http.StatusForbidden {
		t.Fatalf("key without probe scope running a probe: expected 403, got %d", rr.Code)
	}
	if rr := call(http.MethodGet, "/api/workspace/api-keys", "", bearer(writeToken)); rr.Code != http.StatusForbidden {
		t.Fatalf("key managing keys: expected 403, got %d", rr.Code)
	}
	if rr := call(http.MethodGet, "/api/monitors", "", bearer("qnw_not-a-real-key")); rr.Code != http.StatusUnauthorized {
		t.Fatalf("unknown key: expected 401, got %d", rr.Code)
	}

	// The monitor the key created is in the owner's workspace and the audit log names the key.
	monitors, err := st.ListMonitors(t.Context(), testWorkspaceID(t, st, owner.ID))
	if err != nil || len(monitors) != 1 || monitors[0].Name != "From CI" {
		t.Fatalf("expected the key's monitor in the owner's workspace, got %#v (err %v)", monitors, err)
	}
	events, err := st.ListWorkspaceAuditEvents(t.Context(), testWorkspaceID(t, st, owner.ID), store.AuditQuery{Category: "monitor"})
	if err != nil || len(events) != 1 || events[0].ActorEmail != "API key: terraform" {
		t.Fatalf("expected the audit entry to name the key, got %#v (err %v)", events, err)
	}

	if rr := call(http.MethodDelete, fmt.Sprintf("/api/workspace/api-keys?id=%d", readKey.ID), "", withCookie); rr.Code != http.StatusOK {
		t.Fatalf("revoke: %d %s", rr.Code, rr.Body.String())
	}
	time.Sleep(10 * time.Millisecond)
	if rr := call(http.MethodGet, "/api/monitors", "", bearer(readToken)); rr.Code != http.StatusUnauthorized {
		t.Fatalf("revoked key: expected 401, got %d", rr.Code)
	}
}
