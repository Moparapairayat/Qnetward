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
	"qnetward/internal/engine/surface"
	"qnetward/internal/store"
)

// Attack surface scans run only on a domain the workspace has verified, one
// at a time, and finish in the background.
func TestSurfaceScansNeedAVerifiedDomain(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)

	release := make(chan struct{})
	old := surfaceRun
	surfaceRun = func(ctx context.Context, domain string, _ surface.Config) (surface.Report, error) {
		<-release
		return surface.Report{Domain: domain, Grade: "C", Score: 75, Counts: map[passive.Severity]int{passive.High: 1},
			Hosts:    []surface.Host{{Name: "db." + domain, Addresses: []string{"203.0.113.9"}, OpenPorts: []int{5432}}},
			Findings: []surface.Finding{{Host: "db." + domain, Finding: passive.Finding{ID: "surface.port.5432", Severity: passive.High, Title: "PostgreSQL is open"}}},
		}, nil
	}
	t.Cleanup(func() { surfaceRun = old })

	call := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(cookie)
		rr := httptest.NewRecorder()
		testSrv.handleSurfaceScans(rr, req)
		return rr
	}

	if rr := call(http.MethodPost, "/api/security/surface", `{"domain":"example.com"}`); rr.Code != http.StatusForbidden {
		t.Fatalf("an unverified domain must be refused, got %d %s", rr.Code, rr.Body.String())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	workspaceID := testWorkspaceID(t, st, user.ID)
	d, err := st.AddDomain(ctx, store.VerifiedDomain{WorkspaceID: workspaceID, UserID: user.ID, Domain: "example.com", Token: "qnetward-verify=t"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if rr := call(http.MethodPost, "/api/security/surface", `{"domain":"example.com"}`); rr.Code != http.StatusForbidden {
		t.Fatalf("a pending domain must be refused, got %d", rr.Code)
	}
	if _, _, err := st.RecordDomainCheck(ctx, d, store.DomainCheckResult{Found: true, Method: "dns"}); err != nil {
		t.Fatal(err)
	}
	if rr := call(http.MethodPost, "/api/security/surface", `{"domain":"example.org"}`); rr.Code != http.StatusForbidden {
		t.Fatalf("another domain must be refused, got %d", rr.Code)
	}

	rr := call(http.MethodPost, "/api/security/surface", `{"domain":"shop.example.com"}`)
	if rr.Code != http.StatusAccepted {
		t.Fatalf("a subdomain of a verified domain can be scanned: %d %s", rr.Code, rr.Body.String())
	}
	var started store.SecurityScan
	_ = json.Unmarshal(rr.Body.Bytes(), &started)
	if started.Status != "running" || started.Kind != "surface" {
		t.Fatalf("the scan starts running: %s", rr.Body.String())
	}
	if rr := call(http.MethodPost, "/api/security/surface", `{"domain":"example.com"}`); rr.Code != http.StatusConflict {
		t.Fatalf("one scan at a time per workspace, got %d", rr.Code)
	}

	close(release)
	testSrv.background.Wait()
	rr = call(http.MethodGet, fmt.Sprintf("/api/security/surface?id=%d", started.ID), "")
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"status": "done"`) || !strings.Contains(rr.Body.String(), "surface.port.5432") {
		t.Fatalf("the finished scan: %d %s", rr.Code, rr.Body.String())
	}
	// Surface scans don't mix into the passive list.
	req := httptest.NewRequest(http.MethodGet, "/api/security/passive", nil)
	req.AddCookie(cookie)
	prr := httptest.NewRecorder()
	testSrv.handlePassiveScans(prr, req)
	if strings.Contains(prr.Body.String(), "shop.example.com") {
		t.Fatalf("the passive list must not show surface scans: %s", prr.Body.String())
	}
}
