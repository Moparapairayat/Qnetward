package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qnetward/internal/engine/passive"
	"qnetward/internal/engine/surface"
	"qnetward/internal/store"
)

func TestCompareSurface(t *testing.T) {
	before := surface.Report{
		Hosts:    []surface.Host{{Name: "example.com", OpenPorts: []int{80, 443}}, {Name: "db.example.com", OpenPorts: []int{22}}},
		Findings: []surface.Finding{{Host: "old.example.com", Finding: passive.Finding{ID: "surface.takeover", Severity: passive.High}}},
	}
	if c := compareSurface(before, before); !c.empty() {
		t.Fatalf("nothing changed: %+v", c)
	}
	// A new web host alone, or a new harmless port, isn't an alert.
	quiet := surface.Report{Hosts: append(before.Hosts, surface.Host{Name: "blog.example.com", OpenPorts: []int{443}})}
	if c := compareSurface(before, quiet); !c.empty() || len(c.NewHosts) != 1 {
		t.Fatalf("a new web host alone doesn't alert: %+v", c)
	}
	worse := surface.Report{
		Hosts: []surface.Host{{Name: "example.com", OpenPorts: []int{80, 443}}, {Name: "db.example.com", OpenPorts: []int{22, 5432}}},
		Findings: []surface.Finding{
			{Host: "old.example.com", Finding: passive.Finding{ID: "surface.takeover", Severity: passive.High}},
			{Host: "shop.example.com", Finding: passive.Finding{ID: "surface.takeover", Severity: passive.High, Title: "Possible subdomain takeover"}},
			{Host: "db.example.com", Finding: passive.Finding{ID: "surface.port.5432", Severity: passive.High, Title: "PostgreSQL is open"}},
		},
	}
	c := compareSurface(before, worse)
	if c.empty() || len(c.NewPorts) != 1 || c.NewPorts[0] != "PostgreSQL on db.example.com" {
		t.Fatalf("a newly open database alerts: %+v", c)
	}
	if len(c.NewHigh) != 1 || !strings.Contains(c.NewHigh[0], "shop.example.com") {
		t.Fatalf("only the new takeover is a new high, not the old one or the port again: %+v", c.NewHigh)
	}
}

// A scheduled surface scan needs a verified domain, and records its result
// on the watch.
func TestSurfaceWatchRunsOnVerifiedDomains(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	workspaceID := testWorkspaceID(t, st, user.ID)

	old := surfaceRun
	surfaceRun = func(_ context.Context, domain string, _ surface.Config) (surface.Report, error) {
		return surface.Report{Domain: domain, Grade: "A", Score: 96, Counts: map[passive.Severity]int{}, Hosts: []surface.Host{{Name: domain, OpenPorts: []int{443}}}}, nil
	}
	t.Cleanup(func() { surfaceRun = old })

	post := func(body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/security/watches", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		testSrv.handleSecurityWatches(rr, req)
		return rr
	}
	if rr := post(`{"kind":"surface","domain":"example.com"}`); rr.Code != http.StatusForbidden {
		t.Fatalf("an unverified domain can't get scheduled surface scans, got %d", rr.Code)
	}
	d, err := st.AddDomain(ctx, store.VerifiedDomain{WorkspaceID: workspaceID, UserID: user.ID, Domain: "example.com", Token: "qnetward-verify=w"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.RecordDomainCheck(ctx, d, store.DomainCheckResult{Found: true, Method: "dns"}); err != nil {
		t.Fatal(err)
	}
	if rr := post(`{"kind":"surface","domain":"example.com","interval_hours":6}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("surface scans run daily or weekly, got %d", rr.Code)
	}
	rr := post(`{"kind":"surface","domain":"example.com"}`)
	if rr.Code != http.StatusCreated || !strings.Contains(rr.Body.String(), `"interval_hours": 168`) {
		t.Fatalf("create: %d %s", rr.Code, rr.Body.String())
	}
	// The same domain can also have a passive watch.
	if rr := post(`{"domain":"example.com"}`); rr.Code != http.StatusCreated {
		t.Fatalf("a passive watch alongside: %d %s", rr.Code, rr.Body.String())
	}

	watches, err := st.ListSecurityWatches(ctx, workspaceID)
	if err != nil {
		t.Fatal(err)
	}
	var watch store.SecurityWatch
	for _, w := range watches {
		if w.Kind == "surface" {
			watch = w
		}
	}
	testSrv.checkSurfaceWatch(ctx, watch)
	watches, _ = st.ListSecurityWatches(ctx, workspaceID)
	for _, w := range watches {
		if w.Kind == "surface" && (w.LastScanID == nil || w.LastGrade != "A" || w.LastError != "") {
			t.Fatalf("the scheduled scan should be recorded on the watch: %+v", w)
		}
	}
	scans, _ := st.ListSecurityScans(ctx, workspaceID, "surface", "", 10)
	if len(scans) != 1 || scans[0].Status != "done" {
		t.Fatalf("the scheduled scan should be saved: %+v", scans)
	}
}
