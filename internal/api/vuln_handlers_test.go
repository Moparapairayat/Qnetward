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

	"qnetward/internal/engine/surface"
	"qnetward/internal/platform/vulndb"
	"qnetward/internal/store"
)

// Vulnerabilities come from each domain's latest attack surface scan, worst
// first, and a decision about one sticks to that host and CVE.
func TestVulnerabilitiesAndDecisions(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)
	_, otherCookie := issueTestSession(t, st)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	workspaceID := testWorkspaceID(t, st, user.ID)

	save := func(rep surface.Report) {
		raw, _ := json.Marshal(rep)
		scan, err := st.StartSecurityScan(ctx, store.SecurityScan{WorkspaceID: workspaceID, UserID: user.ID, Kind: "surface", Domain: rep.Domain})
		if err != nil {
			t.Fatal(err)
		}
		scan.Report, scan.Grade = raw, rep.Grade
		if err := st.FinishSecurityScan(ctx, scan, ""); err != nil {
			t.Fatal(err)
		}
	}
	nginx := func(cve, sev string, cvss float64, kev bool) surface.Vuln {
		return surface.Vuln{Vuln: vulndb.Vuln{CVE: cve, Severity: sev, CVSS: cvss, KEV: kev}, Host: "www.example.com", Port: 443, Product: "nginx", Version: "1.18.0"}
	}
	// An older scan whose vulnerability is gone now must not show.
	save(surface.Report{Domain: "example.com", Grade: "F", Vulns: []surface.Vuln{nginx("CVE-2001-0001", "critical", 10, true)}})
	time.Sleep(10 * time.Millisecond)
	save(surface.Report{Domain: "example.com", Grade: "C", Vulns: []surface.Vuln{nginx("CVE-2019-0002", "medium", 5, false), nginx("CVE-2021-23017", "critical", 7.7, true)}})

	get := func(c *http.Cookie) []vulnView {
		req := httptest.NewRequest(http.MethodGet, "/api/security/vulnerabilities", nil)
		req.AddCookie(c)
		rr := httptest.NewRecorder()
		testSrv.handleVulnerabilities(rr, req)
		var body struct {
			Vulns []vulnView `json:"vulns"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil || rr.Code != http.StatusOK {
			t.Fatalf("list: %d %v %s", rr.Code, err, rr.Body.String())
		}
		return body.Vulns
	}
	vulns := get(cookie)
	if len(vulns) != 2 || vulns[0].CVE != "CVE-2021-23017" || vulns[0].Domain != "example.com" {
		t.Fatalf("latest scan only, worst first: %+v", vulns)
	}
	if len(get(otherCookie)) != 0 {
		t.Fatal("another workspace must not see these")
	}

	decide := func(c *http.Cookie, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(c)
		rr := httptest.NewRecorder()
		testSrv.handleVulnDispositions(rr, req)
		return rr
	}
	if rr := decide(cookie, http.MethodPost, "/x", `{"host":"www.example.com","cve":"not-a-cve","status":"accepted"}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("a malformed CVE is refused, got %d", rr.Code)
	}
	rr := decide(cookie, http.MethodPost, "/x", `{"host":"WWW.example.com","cve":"cve-2021-23017","status":"false_positive","reason":"Ubuntu backported the fix"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("decide: %d %s", rr.Code, rr.Body.String())
	}
	var d store.VulnDisposition
	_ = json.Unmarshal(rr.Body.Bytes(), &d)
	vulns = get(cookie)
	if vulns[0].Disposition == nil || vulns[0].Disposition.Status != "false_positive" || vulns[0].Disposition.Reason != "Ubuntu backported the fix" {
		t.Fatalf("the decision is attached to its CVE and host: %+v", vulns[0])
	}
	if rr := decide(otherCookie, http.MethodDelete, fmt.Sprintf("/x?id=%d", d.ID), ""); rr.Code != http.StatusNotFound {
		t.Fatalf("another workspace must not undo it, got %d", rr.Code)
	}
	if rr := decide(cookie, http.MethodDelete, fmt.Sprintf("/x?id=%d", d.ID), ""); rr.Code != http.StatusOK {
		t.Fatalf("undo: %d", rr.Code)
	}
	if get(cookie)[0].Disposition != nil {
		t.Fatal("an undone decision is gone")
	}
}
