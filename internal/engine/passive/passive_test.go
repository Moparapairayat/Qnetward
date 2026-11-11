package passive

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestNormalizeDomain(t *testing.T) {
	ok := map[string]string{
		"Example.COM":                    "example.com",
		"https://www.example.com/path?q": "www.example.com",
		"user@mail.example.org":          "mail.example.org",
		"example.com.":                   "example.com",
		"shop.example.co.uk:8443":        "shop.example.co.uk",
		"bücher.example":                 "xn--bcher-kva.example",
	}
	for in, want := range ok {
		got, err := NormalizeDomain(in)
		if err != nil || got != want {
			t.Errorf("NormalizeDomain(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"", "localhost", "1.2.3.4", "[::1]", "co.uk", "-bad.example.com", "a..b.com", "exa mple.com"} {
		if got, err := NormalizeDomain(in); err == nil {
			t.Errorf("NormalizeDomain(%q) = %q, want an error", in, got)
		}
	}
}

func has(fs []Finding, id string, sev Severity) bool {
	for _, f := range fs {
		if f.ID == id && f.Severity == sev {
			return true
		}
	}
	return false
}

func TestAnalyzeEmail(t *testing.T) {
	cases := []struct {
		name  string
		spf   []string
		dmarc string
		mx    bool
		want  map[string]Severity
	}{
		{"nothing, sends mail", nil, "", true, map[string]Severity{"email.spf.missing": High, "email.dmarc.missing": High}},
		{"nothing, no mail", nil, "", false, map[string]Severity{"email.spf.missing": Medium, "email.dmarc.missing": Medium}},
		{"strict", []string{"v=spf1 include:_spf.google.com -all"}, "v=DMARC1; p=reject; rua=mailto:d@example.com", true,
			map[string]Severity{"email.spf.ok": Pass, "email.dmarc.ok": Pass}},
		{"allow all", []string{"v=spf1 +all"}, "v=DMARC1; p=none", true, map[string]Severity{"email.spf.allow_all": High, "email.dmarc.monitor_only": Medium, "email.dmarc.no_reports": Info}},
		{"two spf", []string{"v=spf1 -all", "v=spf1 mx -all"}, "v=DMARC1; p=quarantine; pct=50; rua=mailto:x@y.z", true,
			map[string]Severity{"email.spf.multiple": Medium, "email.dmarc.partial": Low}},
		{"softfail", []string{"v=spf1 mx ~all"}, "v=DMARC1; p=bogus", true, map[string]Severity{"email.spf.softfail": Info, "email.dmarc.invalid": Medium}},
		{"redirect only", []string{"v=spf1 redirect=_spf.example.com"}, "v=DMARC1; p=reject; rua=mailto:a@b.c", true, map[string]Severity{"email.dmarc.ok": Pass}},
	}
	for _, c := range cases {
		got := analyzeEmail(c.spf, c.dmarc, c.mx)
		for id, sev := range c.want {
			if !has(got, id, sev) {
				t.Errorf("%s: missing %s (%s) in %+v", c.name, id, sev, got)
			}
		}
		if c.name == "redirect only" && has(got, "email.spf.no_all", Low) {
			t.Errorf("redirect= delegates the policy; it shouldn't count as missing all")
		}
	}
}

func TestAnalyzeHeaders(t *testing.T) {
	bare := analyzeHeaders(http.Header{"Server": {"nginx/1.18.0"}, "X-Powered-By": {"PHP/7.4"}})
	for id, sev := range map[string]Severity{
		"http.hsts.missing": Medium, "http.csp.missing": Medium, "http.framing": Low,
		"http.nosniff": Low, "http.referrer": Low, "http.permissions": Info, "http.version_leak": Low,
	} {
		if !has(bare, id, sev) {
			t.Errorf("bare response: missing %s (%s)", id, sev)
		}
	}

	good := http.Header{}
	good.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
	good.Set("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'")
	good.Set("X-Content-Type-Options", "nosniff")
	good.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	good.Set("Permissions-Policy", "camera=()")
	good.Set("Server", "cloudflare")
	for _, f := range analyzeHeaders(good) {
		if f.Severity != Pass {
			t.Errorf("hardened response flagged %s (%s)", f.ID, f.Severity)
		}
	}

	weak := http.Header{}
	weak.Set("Strict-Transport-Security", "max-age=300")
	weak.Set("Content-Security-Policy", "script-src 'self' 'unsafe-inline'")
	got := analyzeHeaders(weak)
	if !has(got, "http.hsts.short", Low) || !has(got, "http.csp.unsafe_inline", Low) {
		t.Errorf("weak headers: got %+v", got)
	}
}

func TestGrade(t *testing.T) {
	if s, g, _ := grade([]Finding{{Severity: Pass}, {Severity: Info}}); s != 100 || g != "A+" {
		t.Errorf("clean: %d %s", s, g)
	}
	if s, g, _ := grade([]Finding{{Severity: Low}, {Severity: Low}}); s != 92 || g != "A" {
		t.Errorf("two lows: %d %s", s, g)
	}
	if s, g, c := grade([]Finding{{Severity: High}}); s != 75 || g != "C" || c[High] != 1 {
		t.Errorf("one high: %d %s", s, g)
	}
	if _, g, _ := grade([]Finding{{Severity: High}, {Severity: High}, {Severity: High}, {Severity: High}, {Severity: High}}); g != "F" {
		t.Errorf("five highs: %s", g)
	}
}

// A full scan against local servers standing in for the domain's web server.
func TestRunAgainstLocalServers(t *testing.T) {
	site := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.SetCookie(w, &http.Cookie{Name: "sid", Value: "x", HttpOnly: true})
		_, _ = w.Write([]byte("ok"))
	}))
	site.TLS = &tls.Config{MinVersion: tls.VersionTLS12}
	site.StartTLS()
	defer site.Close()
	plain := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://example.com/", http.StatusMovedPermanently)
	}))
	defer plain.Close()

	roots := x509.NewCertPool()
	roots.AddCert(site.Certificate())
	dnsAnswers := map[string][]string{
		"example.com/1":         {"127.0.0.1"},
		"example.com/15":        {"10 mx.example.com"},
		"example.com/16":        {"v=spf1 mx -all", "google-site-verification=abc"},
		"_dmarc.example.com/16": {"v=DMARC1; p=none; rua=mailto:dmarc@example.com"},
	}
	cfg := Config{
		Timeout: 3 * time.Second,
		RootCAs: roots,
		dialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			_, port, _ := net.SplitHostPort(address)
			target := strings.TrimPrefix(plain.URL, "http://")
			if port == "443" {
				target = strings.TrimPrefix(site.URL, "https://")
			}
			var d net.Dialer
			return d.DialContext(ctx, network, target)
		},
		lookup: func(ctx context.Context, name string, qtype uint16) ([]string, error) {
			if v, ok := dnsAnswers[name+"/"+strconv.Itoa(int(qtype))]; ok {
				return v, nil
			}
			return nil, errNoRecords
		},
	}

	rep, err := Run(context.Background(), "https://Example.com/login", cfg)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Domain != "example.com" || !rep.TLS.Available || rep.TLS.Cert == nil || rep.HTTP.StatusCode != 200 {
		t.Fatalf("unexpected report: %+v", rep)
	}
	// httptest's certificate is for example.com and 127.0.0.1, so it verifies here.
	for id, sev := range map[string]Severity{
		"tls.cert.ok": Pass, "http.redirect.ok": Pass, "http.hsts.ok": Pass, "http.csp.missing": Medium,
		"http.cookies.secure": Low, "email.spf.ok": Pass, "email.dmarc.monitor_only": Medium, "dns.caa.missing": Low, "dns.dnssec.missing": Info,
	} {
		if !has(rep.Findings, id, sev) {
			t.Errorf("missing %s (%s); findings: %+v", id, sev, rep.Findings)
		}
	}
	if rep.Findings[0].Severity != Medium || rep.Grade == "" || rep.Score >= 100 {
		t.Errorf("findings should be worst first and graded: %s %d %+v", rep.Grade, rep.Score, rep.Findings[0])
	}
	if rep.HTTP.Headers["Strict-Transport-Security"] == "" {
		t.Error("the report should list the security headers it saw")
	}

	// The SSRF policy is asked before anything connects.
	blocked := cfg
	blocked.CheckHost = func(context.Context, string) error { return errors.New("private address") }
	if _, err := Run(context.Background(), "example.com", blocked); err == nil || !strings.Contains(err.Error(), "private address") {
		t.Fatalf("a blocked address must stop the scan, got %v", err)
	}

	// A name with no web or mail servers can't be scanned.
	if _, err := Run(context.Background(), "nothing-here.example.com", cfg); err == nil {
		t.Fatal("expected an error for a domain with no records")
	}
}
