package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qnetward/internal/compliance"
	"qnetward/internal/store"
)

// The compliance view is built from the workspace's own latest scans and
// exports the same as CSV.
func TestComplianceAPI(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)
	_, otherCookie := issueTestSession(t, st)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	ws := testWorkspaceID(t, st, user.ID)

	call := func(c *http.Cookie, path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.AddCookie(c)
		rr := httptest.NewRecorder()
		testSrv.handleCompliance(rr, req)
		return rr
	}
	statuses := func(c *http.Cookie) map[string]compliance.Status {
		rr := call(c, "/api/security/compliance")
		if rr.Code != http.StatusOK {
			t.Fatalf("compliance: %d %s", rr.Code, rr.Body.String())
		}
		var rep compliance.Report
		_ = json.Unmarshal(rr.Body.Bytes(), &rep)
		out := map[string]compliance.Status{}
		for _, r := range rep.Controls {
			out[r.ID] = r.Status
		}
		return out
	}

	if s := statuses(cookie); s["email-authentication"] != compliance.NotAssessed {
		t.Fatalf("nothing scanned yet: %v", s)
	}
	report := json.RawMessage(`{"domain":"example.com","grade":"C","score":70,"findings":[
		{"id":"email.dmarc.missing","category":"email","severity":"high","title":"No DMARC record"},
		{"id":"http.csp.missing","category":"http","severity":"medium","title":"No Content-Security-Policy"},
		{"id":"tls.cert.ok","category":"tls","severity":"pass","title":"Certificate is valid"}]}`)
	if _, err := st.SaveSecurityScan(ctx, store.SecurityScan{WorkspaceID: ws, UserID: user.ID, Kind: "passive", Domain: "example.com", Grade: "C", Score: 70, High: 1, Medium: 1, Report: report}); err != nil {
		t.Fatal(err)
	}
	s := statuses(cookie)
	if s["email-authentication"] != compliance.Fail || s["browser-protections"] != compliance.Warn || s["certificates"] != compliance.Pass || s["exposed-services"] != compliance.NotAssessed {
		t.Fatalf("statuses follow the scan: %v", s)
	}
	if o := statuses(otherCookie); o["email-authentication"] != compliance.NotAssessed {
		t.Fatalf("another workspace doesn't see this evidence: %v", o)
	}

	rr := call(cookie, "/api/security/compliance?format=csv")
	body := rr.Body.String()
	if rr.Code != http.StatusOK || !strings.HasPrefix(rr.Header().Get("Content-Type"), "text/csv") ||
		!strings.Contains(body, "Email senders are authenticated,Email security,Fail") || !strings.Contains(body, "No DMARC record on example.com") {
		t.Fatalf("csv: %d %s", rr.Code, body)
	}
}
