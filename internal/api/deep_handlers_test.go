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

	"qnetward/internal/engine/deep"
	"qnetward/internal/engine/passive"
	"qnetward/internal/store"
)

// A deep scan needs a paid plan, a verified scope, a signature over the
// exact text shown, and a platform admin's approval; then it runs.
func TestDeepScanRequestFlow(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)
	admin, adminCookie := issueTestSession(t, st)
	_, otherCookie := issueTestSession(t, st)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	workspaceID := testWorkspaceID(t, st, user.ID)

	oldAdmins := testSrv.adminEmails
	testSrv.adminEmails = map[string]struct{}{strings.ToLower(admin.Email): {}}
	t.Cleanup(func() { testSrv.adminEmails = oldAdmins })
	ran := make(chan []string, 1)
	oldRun := deepRun
	deepRun = func(_ context.Context, domain string, hosts, checks []string, _ deep.Config) (deep.Report, error) {
		ran <- hosts
		return deep.Report{Domain: domain, Hosts: hosts, Checks: checks, Grade: "C", Score: 75, Counts: map[passive.Severity]int{passive.High: 1},
			Findings: []deep.Finding{{Host: hosts[0], URL: "https://" + hosts[0] + "/.env", Finding: passive.Finding{ID: "deep.env", Severity: passive.High, Title: "Environment file is public"}}}}, nil
	}
	t.Cleanup(func() { deepRun = oldRun })

	call := func(c *http.Cookie, handler http.HandlerFunc, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(c)
		rr := httptest.NewRecorder()
		handler(rr, req)
		return rr
	}
	request := `{"domain":"example.com","hosts":["www.example.com","example.com"],"window_hours":24,"name":"Mopara Pair Ayat"}`

	if rr := call(cookie, testSrv.handleDeepScans, http.MethodPost, "/api/security/deep?preview=1", request); rr.Code != http.StatusPaymentRequired {
		t.Fatalf("the free plan has no deep scans, got %d", rr.Code)
	}
	if err := st.SetWorkspacePlan(ctx, workspaceID, "pro"); err != nil {
		t.Fatal(err)
	}
	if rr := call(cookie, testSrv.handleDeepScans, http.MethodPost, "/api/security/deep?preview=1", request); rr.Code != http.StatusBadRequest {
		t.Fatalf("an unverified domain is refused, got %d %s", rr.Code, rr.Body.String())
	}
	d, err := st.AddDomain(ctx, store.VerifiedDomain{WorkspaceID: workspaceID, UserID: user.ID, Domain: "example.com", Token: "qnetward-verify=d"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.RecordDomainCheck(ctx, d, store.DomainCheckResult{Found: true, Method: "dns"}); err != nil {
		t.Fatal(err)
	}
	if rr := call(cookie, testSrv.handleDeepScans, http.MethodPost, "/api/security/deep?preview=1", `{"domain":"example.com","hosts":["evil.org"],"window_hours":24,"name":"Mopara Pair Ayat"}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("hosts outside the domain are refused, got %d", rr.Code)
	}

	rr := call(cookie, testSrv.handleDeepScans, http.MethodPost, "/api/security/deep?preview=1", request)
	var preview struct {
		Text  string        `json:"text"`
		Hash  string        `json:"hash"`
		Input deepScanInput `json:"input"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &preview)
	if rr.Code != http.StatusOK || !strings.Contains(preview.Text, "I, Mopara Pair Ayat, confirm") || !strings.Contains(preview.Text, "example.com, www.example.com") || len(preview.Hash) != 64 {
		t.Fatalf("preview: %d %s", rr.Code, rr.Body.String())
	}
	signed := func(hash string) string {
		return fmt.Sprintf(`{"domain":"example.com","hosts":["www.example.com","example.com"],"window_hours":24,"name":"Mopara Pair Ayat","window_start":%q,"consent_hash":%q,"accept":true}`,
			preview.Input.WindowStart.Format(time.RFC3339), hash)
	}
	if rr := call(cookie, testSrv.handleDeepScans, http.MethodPost, "/api/security/deep", signed(strings.Repeat("0", 64))); rr.Code != http.StatusBadRequest {
		t.Fatalf("a signature over different text is refused, got %d", rr.Code)
	}
	rr = call(cookie, testSrv.handleDeepScans, http.MethodPost, "/api/security/deep", signed(preview.Hash))
	if rr.Code != http.StatusCreated {
		t.Fatalf("submit: %d %s", rr.Code, rr.Body.String())
	}
	var req store.DeepScanRequest
	_ = json.Unmarshal(rr.Body.Bytes(), &req)
	if req.Status != "pending" || req.ConsentText != preview.Text || req.ConsentName != "Mopara Pair Ayat" {
		t.Fatalf("the request keeps exactly what was signed: %+v", req)
	}

	// Nothing runs before approval, and only platform admins approve.
	select {
	case <-ran:
		t.Fatal("a scan ran before approval")
	default:
	}
	review := fmt.Sprintf(`{"id":%d,"approve":true}`, req.ID)
	if rr := call(cookie, testSrv.handleAdminDeepScans, http.MethodPost, "/api/admin/deep-scans", review); rr.Code != http.StatusForbidden && rr.Code != http.StatusNotFound {
		t.Fatalf("a workspace owner can't approve their own request, got %d", rr.Code)
	}
	if rr := call(otherCookie, testSrv.handleDeepScans, http.MethodDelete, fmt.Sprintf("/api/security/deep?id=%d", req.ID), ""); rr.Code != http.StatusForbidden && rr.Code != http.StatusNotFound && rr.Code != http.StatusPaymentRequired {
		t.Fatalf("another workspace can't cancel it, got %d", rr.Code)
	}
	if rr := call(adminCookie, testSrv.handleAdminDeepScans, http.MethodPost, "/api/admin/deep-scans", fmt.Sprintf(`{"id":%d,"approve":false}`, req.ID)); rr.Code != http.StatusBadRequest {
		t.Fatalf("a rejection needs a reason, got %d", rr.Code)
	}
	if rr := call(adminCookie, testSrv.handleAdminDeepScans, http.MethodPost, "/api/admin/deep-scans", review); rr.Code != http.StatusOK {
		t.Fatalf("approve: %d %s", rr.Code, rr.Body.String())
	}
	select {
	case hosts := <-ran:
		if strings.Join(hosts, ",") != "example.com,www.example.com" {
			t.Fatalf("the scan covers exactly the approved hosts: %v", hosts)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("an approved scan whose window is open should start")
	}
	testSrv.background.Wait()

	list, err := st.ListDeepScanRequests(ctx, workspaceID)
	if err != nil || len(list) != 1 || list[0].Status != "completed" || list[0].ScanID == nil {
		t.Fatalf("the request is completed with its scan: %+v %v", list, err)
	}
	scan, err := st.GetSecurityScan(ctx, workspaceID, *list[0].ScanID)
	if err != nil || scan.Kind != "deep" || scan.High != 1 {
		t.Fatalf("the deep scan is saved: %+v %v", scan, err)
	}
	if rr := call(adminCookie, testSrv.handleAdminDeepScans, http.MethodPost, "/api/admin/deep-scans", review); rr.Code != http.StatusConflict {
		t.Fatalf("a request is reviewed once, got %d", rr.Code)
	}
}
