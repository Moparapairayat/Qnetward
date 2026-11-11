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

	"qnetward/internal/engine/passive"
	"qnetward/internal/store"
)

func TestCompareReports(t *testing.T) {
	before := passive.Report{Grade: "A", Findings: []passive.Finding{{ID: "email.dmarc.missing", Severity: passive.High, Title: "No DMARC policy"}}}

	same := compareReports(before, before)
	if !same.empty() {
		t.Fatalf("nothing changed: %+v", same)
	}
	better := compareReports(before, passive.Report{Grade: "A+"})
	if !better.empty() {
		t.Fatalf("getting better isn't an alert: %+v", better)
	}
	worse := compareReports(before, passive.Report{Grade: "C", Findings: []passive.Finding{
		{ID: "email.dmarc.missing", Severity: passive.High, Title: "No DMARC policy"},
		{ID: "tls.cert.expiring", Severity: passive.High, Title: "The certificate expires in 9 days"},
	}})
	if !worse.GradeDropped || len(worse.NewHigh) != 1 || worse.NewHigh[0] != "The certificate expires in 9 days" {
		t.Fatalf("expected a drop and one new high issue, got %+v", worse)
	}
	newOnly := compareReports(passive.Report{Grade: "C"}, passive.Report{Grade: "C", Findings: []passive.Finding{{ID: "tls.legacy_only", Severity: passive.High, Title: "Old TLS"}}})
	if newOnly.GradeDropped || len(newOnly.NewHigh) != 1 {
		t.Fatalf("a new high issue alerts even when the grade holds: %+v", newOnly)
	}
}

func TestSecurityWatchesAPI(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)
	_, otherCookie := issueTestSession(t, st)

	call := func(c *http.Cookie, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(c)
		rr := httptest.NewRecorder()
		testSrv.handleSecurityWatches(rr, req)
		return rr
	}

	// An earlier manual scan becomes the watch's starting point.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	workspaceID := testWorkspaceID(t, st, user.ID)
	prior, err := st.SaveSecurityScan(ctx, store.SecurityScan{WorkspaceID: workspaceID, UserID: user.ID, Domain: "example.com", Grade: "B", Score: 84, Report: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}

	rr := call(cookie, http.MethodPost, "/api/security/watches", `{"domain":"https://Example.com/","interval_hours":24,"notify_email":"ops@example.com"}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rr.Code, rr.Body.String())
	}
	var created store.SecurityWatch
	_ = json.Unmarshal(rr.Body.Bytes(), &created)
	if created.Domain != "example.com" || created.LastGrade != "B" || created.LastScanID == nil || *created.LastScanID != prior.ID {
		t.Fatalf("the watch should start from the last scan: %s", rr.Body.String())
	}

	if rr := call(cookie, http.MethodPost, "/api/security/watches", `{"domain":"example.com"}`); rr.Code != http.StatusConflict {
		t.Fatalf("a domain is watched once, got %d", rr.Code)
	}
	if rr := call(cookie, http.MethodPost, "/api/security/watches", `{"domain":"example.org","interval_hours":5}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("intervals are 6, 24, or 168 hours, got %d", rr.Code)
	}
	for _, d := range []string{"example.org", "example.net"} {
		if rr := call(cookie, http.MethodPost, "/api/security/watches", fmt.Sprintf(`{"domain":%q}`, d)); rr.Code != http.StatusCreated {
			t.Fatalf("create %s: %d %s", d, rr.Code, rr.Body.String())
		}
	}
	// The free plan watches three domains.
	if rr := call(cookie, http.MethodPost, "/api/security/watches", `{"domain":"example.edu"}`); rr.Code != http.StatusConflict {
		t.Fatalf("a fourth watch on the free plan should be refused, got %d %s", rr.Code, rr.Body.String())
	}

	// Due watches are claimed once and moved a full interval ahead.
	due, err := st.ClaimDueSecurityWatches(ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	mine := 0
	for _, w := range due {
		if w.WorkspaceID == workspaceID {
			mine++
			if time.Until(w.NextRunAt) < time.Duration(w.IntervalHours-1)*time.Hour {
				t.Fatalf("a claimed watch should move a full interval ahead: %+v", w)
			}
		}
	}
	if mine != 3 {
		t.Fatalf("expected the three new watches to be due, got %d", mine)
	}
	again, _ := st.ClaimDueSecurityWatches(ctx, 100)
	for _, w := range again {
		if w.WorkspaceID == workspaceID {
			t.Fatal("a claimed watch isn't due again until its interval passes")
		}
	}

	if rr := call(otherCookie, http.MethodGet, "/api/security/watches", ""); strings.Contains(rr.Body.String(), "example.com") {
		t.Fatalf("another workspace must not see the watches: %s", rr.Body.String())
	}
	if rr := call(otherCookie, http.MethodDelete, fmt.Sprintf("/api/security/watches?id=%d", created.ID), ""); rr.Code != http.StatusNotFound {
		t.Fatalf("another workspace must not delete a watch, got %d", rr.Code)
	}

	rr = call(cookie, http.MethodPost, "/api/security/watches", fmt.Sprintf(`{"id":%d,"interval_hours":168,"enabled":false}`, created.ID))
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"enabled": false`) || !strings.Contains(rr.Body.String(), `"interval_hours": 168`) {
		t.Fatalf("update: %d %s", rr.Code, rr.Body.String())
	}
	if rr := call(cookie, http.MethodDelete, fmt.Sprintf("/api/security/watches?id=%d", created.ID), ""); rr.Code != http.StatusOK {
		t.Fatalf("delete: %d", rr.Code)
	}
	rr = call(cookie, http.MethodGet, "/api/security/watches", "")
	var list struct {
		Watches []store.SecurityWatch `json:"watches"`
		Limit   int                   `json:"limit"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &list)
	if len(list.Watches) != 2 || list.Limit != 3 {
		t.Fatalf("list after delete: %s", rr.Body.String())
	}
}
