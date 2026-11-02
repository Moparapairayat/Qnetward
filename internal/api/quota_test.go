package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qnetward/internal/plans"
)

// A workspace that has used its hourly scan quota gets a 429, the usage
// endpoint reports the plan and counts, and a platform admin can move the
// workspace to a bigger plan.
func TestWorkspaceQuotasAndPlans(t *testing.T) {
	st := installTestStore(t)
	owner, cookie := issueTestSession(t, st)
	workspaceID := testWorkspaceID(t, st, owner.ID)
	free := plans.For(plans.Free)

	usage := func() usageResponse {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/workspace/usage", nil)
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		testSrv.handleWorkspaceUsage(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("usage: %d %s", rr.Code, rr.Body.String())
		}
		var resp usageResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode usage: %v", err)
		}
		return resp
	}

	got := usage()
	if got.Plan.ID != plans.Free || got.Usage.Members != 1 || got.Usage.ScansLastHour != 0 || len(got.Plans) != len(plans.IDs) || got.Usage.DataRegion != "ap-southeast-1" {
		t.Fatalf("unexpected usage for a new workspace: %+v", got)
	}

	// Use up the hour's scans, then one more is refused.
	for range free.Limits.ScansPerHour {
		testSrv.quotaLimiter.Allow(quotaKey(workspaceID, quotaScan), rateLimitConfig{Limit: free.Limits.ScansPerHour, Window: time.Hour})
	}
	req := httptest.NewRequest(http.MethodPost, "/api/portscan", strings.NewReader(`{"host":"127.0.0.1","ports":"1"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	rr := httptest.NewRecorder()
	testSrv.handlePortScan(rr, req)
	if rr.Code != http.StatusTooManyRequests || rr.Header().Get("Retry-After") == "" {
		t.Fatalf("expected 429 with Retry-After once the scan quota is used, got %d", rr.Code)
	}
	if got := usage(); got.Usage.ScansLastHour != free.Limits.ScansPerHour {
		t.Fatalf("expected %d scans counted, got %d", free.Limits.ScansPerHour, got.Usage.ScansLastHour)
	}

	// A platform admin moves the workspace to Pro; the higher limits apply at once.
	admin, adminCookie := issueTestSession(t, st)
	previous := testSrv.adminEmails
	testSrv.adminEmails = map[string]struct{}{strings.ToLower(admin.Email): {}}
	t.Cleanup(func() { testSrv.adminEmails = previous })

	planReq := httptest.NewRequest(http.MethodPost, "/api/admin/workspaces/plan", strings.NewReader(`{"workspace_id":`+itoa(workspaceID)+`,"plan":"pro"}`))
	planReq.Header.Set("Content-Type", "application/json")
	planReq.AddCookie(adminCookie)
	planRR := httptest.NewRecorder()
	testSrv.handleAdminWorkspacePlan(planRR, planReq)
	if planRR.Code != http.StatusOK {
		t.Fatalf("plan change: %d %s", planRR.Code, planRR.Body.String())
	}
	if got := usage(); got.Plan.ID != plans.Pro || got.Plan.Limits.Monitors != plans.For(plans.Pro).Limits.Monitors {
		t.Fatalf("expected the Pro plan after the change, got %+v", got.Plan)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/portscan", strings.NewReader(`{"host":"127.0.0.1","ports":"1"}`))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(cookie)
	testSrv.handlePortScan(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected the Pro scan quota to allow another scan, got %d %s", rr.Code, rr.Body.String())
	}

	// Ordinary members can't change plans.
	planRR = httptest.NewRecorder()
	planReq = httptest.NewRequest(http.MethodPost, "/api/admin/workspaces/plan", strings.NewReader(`{"workspace_id":`+itoa(workspaceID)+`,"plan":"enterprise"}`))
	planReq.Header.Set("Content-Type", "application/json")
	planReq.AddCookie(cookie)
	testSrv.handleAdminWorkspacePlan(planRR, planReq)
	if planRR.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a non-admin plan change, got %d", planRR.Code)
	}
}

func itoa(v int64) string {
	b, _ := json.Marshal(v)
	return string(b)
}
