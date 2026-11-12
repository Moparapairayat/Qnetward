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

	"qnetward/internal/platform/ownership"
	"qnetward/internal/store"
)

// A workspace adds a domain and gets its own token and instructions; another
// workspace can neither see nor remove it. Proof found verifies the domain
// and covers its subdomains.
func TestDomainsAPIAndLifecycle(t *testing.T) {
	st := installTestStore(t)
	user, cookie := issueTestSession(t, st)
	_, otherCookie := issueTestSession(t, st)

	call := func(handler http.HandlerFunc, c *http.Cookie, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(c)
		rr := httptest.NewRecorder()
		handler(rr, req)
		return rr
	}

	if rr := call(testSrv.handleDomains, cookie, http.MethodPost, "/api/assets/domains", `{"domain":"10.1.2.3"}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("an IP is not a domain, got %d", rr.Code)
	}
	rr := call(testSrv.handleDomains, cookie, http.MethodPost, "/api/assets/domains", `{"domain":"https://Example.com/"}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("add: %d %s", rr.Code, rr.Body.String())
	}
	var added domainView
	_ = json.Unmarshal(rr.Body.Bytes(), &added)
	if added.Domain != "example.com" || added.Status != "pending" || !strings.HasPrefix(added.Token, ownership.TokenPrefix) ||
		added.RecordName != "_qnetward-verify.example.com" || added.FileURL != "https://example.com/.well-known/qnetward-verify.txt" {
		t.Fatalf("unexpected domain: %s", rr.Body.String())
	}
	if rr := call(testSrv.handleDomains, cookie, http.MethodPost, "/api/assets/domains", `{"domain":"example.com"}`); rr.Code != http.StatusConflict {
		t.Fatalf("a domain is added once, got %d", rr.Code)
	}

	// The other workspace gets its own token for the same domain.
	rr = call(testSrv.handleDomains, otherCookie, http.MethodPost, "/api/assets/domains", `{"domain":"example.com"}`)
	var theirs domainView
	_ = json.Unmarshal(rr.Body.Bytes(), &theirs)
	if rr.Code != http.StatusCreated || theirs.Token == added.Token {
		t.Fatalf("each workspace proves the domain with its own token: %d %s", rr.Code, rr.Body.String())
	}
	if rr := call(testSrv.handleDomains, otherCookie, http.MethodDelete, fmt.Sprintf("/api/assets/domains?id=%d", added.ID), ""); rr.Code != http.StatusNotFound {
		t.Fatalf("another workspace must not remove the domain, got %d", rr.Code)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	workspaceID := testWorkspaceID(t, st, user.ID)
	if _, err := st.VerifiedDomainFor(ctx, workspaceID, "www.example.com"); err == nil {
		t.Fatal("a pending domain must not allow deep checks")
	}

	// A failed check keeps it pending and records why.
	added.WorkspaceID = workspaceID
	d, before, err := st.RecordDomainCheck(ctx, added.VerifiedDomain, store.DomainCheckResult{Error: "DNS: no TXT record"})
	if err != nil || d.Status != "pending" || before != "pending" || d.LastError == "" {
		t.Fatalf("missing proof on a new domain: %+v %q %v", d, before, err)
	}
	d, before, err = st.RecordDomainCheck(ctx, d, store.DomainCheckResult{Found: true, Method: ownership.MethodDNS})
	if err != nil || d.Status != "verified" || before != "pending" || d.Method != "dns" || d.VerifiedAt == nil {
		t.Fatalf("proof found: %+v %v", d, err)
	}
	for _, host := range []string{"example.com", "www.example.com", "a.b.example.com"} {
		if _, err := st.VerifiedDomainFor(ctx, workspaceID, host); err != nil {
			t.Fatalf("%s should be covered: %v", host, err)
		}
	}
	for _, host := range []string{"badexample.com", "example.com.evil.net", "example.org"} {
		if _, err := st.VerifiedDomainFor(ctx, workspaceID, host); err == nil {
			t.Fatalf("%s must not be covered", host)
		}
	}

	rr = call(testSrv.handleDomains, cookie, http.MethodGet, "/api/assets/domains", "")
	if !strings.Contains(rr.Body.String(), `"verified"`) || strings.Contains(rr.Body.String(), theirs.Token) {
		t.Fatalf("list: %s", rr.Body.String())
	}
	if rr := call(testSrv.handleDomains, cookie, http.MethodDelete, fmt.Sprintf("/api/assets/domains?id=%d", added.ID), ""); rr.Code != http.StatusOK {
		t.Fatalf("remove: %d", rr.Code)
	}
}
