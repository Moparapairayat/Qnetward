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

// A published page shows its monitors under their display names, with daily
// history, and never the target behind them. Unpublished pages don't exist
// to the public, and the Free plan allows one page.
func TestStatusPagePublishAndPublicView(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)
	workspaceID := testWorkspaceID(t, st, user.ID)
	ctx := context.Background()

	m, err := st.SaveMonitor(ctx, store.Monitor{WorkspaceID: workspaceID, UserID: user.ID, Protocol: "ping", Target: "secret-db.internal.example", IntervalSeconds: 60, Enabled: true}, 20)
	if err != nil {
		t.Fatalf("save monitor: %v", err)
	}
	m.WorkspaceID = workspaceID
	rtt := 9.0
	for _, c := range []store.MonitorCheck{
		{CheckedAt: time.Now().Add(-26 * time.Hour), OK: true, RttMs: &rtt},
		{CheckedAt: time.Now().Add(-2 * time.Minute), OK: false, Error: "timeout"},
		{CheckedAt: time.Now().Add(-1 * time.Minute), OK: true, RttMs: &rtt},
	} {
		if _, err := st.RecordMonitorCheck(ctx, m, c); err != nil {
			t.Fatalf("record check: %v", err)
		}
	}

	save := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/status-pages", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		testSrv.handleStatusPages(rr, req)
		return rr
	}
	public := func(slug string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/public/status/"+slug, nil)
		req.SetPathValue("slug", slug)
		rr := httptest.NewRecorder()
		testSrv.handlePublicStatusPage(rr, req)
		return rr
	}

	slug := fmt.Sprintf("acme-%d", time.Now().UnixNano()%1_000_000_000)
	if rr := save(`{"slug":"Not A Slug!","title":"Acme"}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("bad slug: expected 400, got %d", rr.Code)
	}
	rr := save(fmt.Sprintf(`{"slug":%q,"title":"Acme status","monitors":[{"monitor_id":%d,"label":"Database"},{"monitor_id":999999999,"label":"Not ours"}]}`, slug, m.ID))
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var page store.StatusPage
	_ = json.Unmarshal(rr.Body.Bytes(), &page)
	if len(page.Monitors) != 1 || page.Monitors[0].Label != "Database" {
		t.Fatalf("expected only our monitor on the page, got %+v", page.Monitors)
	}

	if rr := public(slug); rr.Code != http.StatusNotFound {
		t.Fatalf("unpublished page: expected 404, got %d", rr.Code)
	}
	if rr := save(fmt.Sprintf(`{"id":%d,"slug":%q,"title":"Acme status","published":true,"monitors":[{"monitor_id":%d,"label":"Database"}]}`, page.ID, slug, m.ID)); rr.Code != http.StatusOK {
		t.Fatalf("publish: got %d: %s", rr.Code, rr.Body.String())
	}

	rr = public(slug)
	if rr.Code != http.StatusOK || rr.Header().Get("Cache-Control") == "" {
		t.Fatalf("public page: got %d", rr.Code)
	}
	if strings.Contains(rr.Body.String(), "secret-db") || strings.Contains(rr.Body.String(), "internal.example") {
		t.Fatalf("the public page must not reveal the monitor's target: %s", rr.Body.String())
	}
	var body struct {
		Status string `json:"status"`
		Page   struct {
			Components []store.PublicComponent `json:"components"`
		} `json:"page"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &body)
	if body.Status != "operational" || len(body.Page.Components) != 1 {
		t.Fatalf("unexpected public page %s", rr.Body.String())
	}
	c := body.Page.Components[0]
	checks, failed := 0, 0
	for _, d := range c.Days {
		checks += d.Checks
		failed += d.Failed
	}
	if c.Name != "Database" || c.Status != "up" || checks != 3 || failed != 1 {
		t.Fatalf("expected Database up with 3 checks and 1 failure, got %+v", c)
	}

	if rr := save(fmt.Sprintf(`{"slug":"%s-2","title":"Second"}`, slug)); rr.Code != http.StatusConflict {
		t.Fatalf("second page on Free: expected 409, got %d", rr.Code)
	}

	del := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/status-pages?id=%d", page.ID), nil)
	del.AddCookie(cookie)
	delRR := httptest.NewRecorder()
	testSrv.handleStatusPages(delRR, del)
	if delRR.Code != http.StatusOK || public(slug).Code != http.StatusNotFound {
		t.Fatalf("delete: got %d, and the public page should be gone", delRR.Code)
	}
}

func TestOverallStatus(t *testing.T) {
	cases := map[string][]string{
		"unknown":     {"pending", "paused"},
		"operational": {"up", "up", "paused"},
		"degraded":    {"up", "down"},
		"outage":      {"down", "down"},
	}
	for want, statuses := range cases {
		var cs []store.PublicComponent
		for _, s := range statuses {
			cs = append(cs, store.PublicComponent{Status: s})
		}
		if got := overallStatus(cs); got != want {
			t.Errorf("overallStatus(%v) = %q, want %q", statuses, got, want)
		}
	}
}
