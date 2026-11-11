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

	"qnetward/internal/store"
)

// Scans are listed and opened only in their own workspace, bad domains are
// refused before anything runs, and a scan can be deleted.
func TestPassiveScansAPI(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)
	_, otherCookie := issueTestSession(t, st)

	call := func(c *http.Cookie, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(c)
		rr := httptest.NewRecorder()
		testSrv.handlePassiveScans(rr, req)
		return rr
	}

	for _, bad := range []string{`{"domain":""}`, `{"domain":"10.0.0.1"}`, `{"domain":"localhost"}`, `{"domain":"co.uk"}`} {
		if rr := call(cookie, http.MethodPost, "/api/security/passive", bad); rr.Code != http.StatusBadRequest {
			t.Fatalf("%s: expected 400, got %d: %s", bad, rr.Code, rr.Body.String())
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	report := json.RawMessage(`{"domain":"example.com","grade":"B","score":82,"findings":[{"id":"http.csp.missing","category":"http","severity":"medium","title":"No Content-Security-Policy"}]}`)
	saved, err := st.SaveSecurityScan(ctx, store.SecurityScan{
		WorkspaceID: testWorkspaceID(t, st, user.ID), UserID: user.ID, Domain: "example.com", Grade: "B", Score: 82, Medium: 1, Report: report,
	})
	if err != nil {
		t.Fatal(err)
	}

	rr := call(cookie, http.MethodGet, "/api/security/passive", "")
	var list struct {
		Scans []store.SecurityScan `json:"scans"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &list)
	if rr.Code != http.StatusOK || len(list.Scans) != 1 || list.Scans[0].Grade != "B" || len(list.Scans[0].Report) != 0 {
		t.Fatalf("list: %d %s", rr.Code, rr.Body.String())
	}

	rr = call(cookie, http.MethodGet, fmt.Sprintf("/api/security/passive?id=%d", saved.ID), "")
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "http.csp.missing") {
		t.Fatalf("get: %d %s", rr.Code, rr.Body.String())
	}

	if rr := call(otherCookie, http.MethodGet, fmt.Sprintf("/api/security/passive?id=%d", saved.ID), ""); rr.Code != http.StatusNotFound {
		t.Fatalf("another workspace must not see the scan, got %d", rr.Code)
	}
	if rr := call(otherCookie, http.MethodGet, "/api/security/passive", ""); strings.Contains(rr.Body.String(), "example.com") {
		t.Fatalf("another workspace must not list the scan: %s", rr.Body.String())
	}
	if rr := call(otherCookie, http.MethodDelete, fmt.Sprintf("/api/security/passive?id=%d", saved.ID), ""); rr.Code != http.StatusNotFound {
		t.Fatalf("another workspace must not delete the scan, got %d", rr.Code)
	}

	if rr := call(cookie, http.MethodGet, "/api/security/passive?domain=https://Example.com/x", ""); !strings.Contains(rr.Body.String(), `"example.com"`) {
		t.Fatalf("filtering by a URL should match its domain: %s", rr.Body.String())
	}
	if rr := call(cookie, http.MethodDelete, fmt.Sprintf("/api/security/passive?id=%d", saved.ID), ""); rr.Code != http.StatusOK {
		t.Fatalf("delete: got %d", rr.Code)
	}
	if rr := call(cookie, http.MethodGet, fmt.Sprintf("/api/security/passive?id=%d", saved.ID), ""); rr.Code != http.StatusNotFound {
		t.Fatalf("a deleted scan is gone, got %d", rr.Code)
	}
}
