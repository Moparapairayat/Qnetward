package passive

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const (
	maxHops   = 5
	userAgent = "Qnetward-PassiveCheck/1.0 (+https://qnetward.com)"
	// 180 days, the least HSTS that counts as long-lived.
	hstsMinAge = 15552000
)

// headersShown are the response headers the report lists.
var headersShown = []string{
	"Strict-Transport-Security", "Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options",
	"Referrer-Policy", "Permissions-Policy", "Server", "X-Powered-By",
}

func httpClient(cfg Config) *http.Client {
	transport := &http.Transport{
		Proxy:       nil,
		DialContext: dialer(cfg),
		// The certificate is judged by the TLS check; here it only matters
		// that headers can still be read from a site with a bad one.
		TLSClientConfig:        &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: cfg.RootCAs, CurvePreferences: classicCurves, InsecureSkipVerify: true}, //nolint:gosec // see above
		TLSHandshakeTimeout:    cfg.Timeout,
		ResponseHeaderTimeout:  cfg.Timeout,
		DisableKeepAlives:      true,
		MaxResponseHeaderBytes: 64 << 10,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   cfg.Timeout,
		// Redirects are followed by hand, to see each hop.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// follow requests start and follows up to five redirects, returning the last
// response (body closed) and every URL visited.
func follow(ctx context.Context, client *http.Client, start string) (*http.Response, []string, error) {
	current := start
	visited := []string{current}
	for hop := 0; ; hop++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, current, nil)
		if err != nil {
			return nil, visited, err
		}
		req.Header.Set("User-Agent", userAgent)
		req.Header.Set("Accept", "text/html,*/*")
		resp, err := client.Do(req)
		if err != nil {
			return nil, visited, err
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		resp.Body.Close()
		loc := resp.Header.Get("Location")
		if resp.StatusCode < 300 || resp.StatusCode >= 400 || loc == "" || hop >= maxHops {
			return resp, visited, nil
		}
		next, err := resp.Request.URL.Parse(loc)
		if err != nil || (next.Scheme != "http" && next.Scheme != "https") {
			return resp, visited, nil
		}
		current = next.String()
		visited = append(visited, current)
	}
}

func checkHTTP(ctx context.Context, cfg Config, domain string, httpsUp bool, info *HTTPInfo) []Finding {
	client := httpClient(cfg)
	defer client.CloseIdleConnections()
	var out []Finding

	// Plain HTTP should send visitors to HTTPS.
	if resp, visited, err := follow(ctx, client, "http://"+domain+"/"); err == nil {
		last, _ := url.Parse(visited[len(visited)-1])
		upgrades := last != nil && last.Scheme == "https"
		info.RedirectsToHTTPS = &upgrades
		switch {
		case upgrades:
			out = append(out, Finding{ID: "http.redirect.ok", Category: CategoryHTTP, Severity: Pass, Title: "HTTP redirects to HTTPS"})
		case httpsUp:
			out = append(out, Finding{ID: "http.redirect.missing", Category: CategoryHTTP, Severity: Medium,
				Title: "HTTP doesn't redirect to HTTPS", Detail: fmt.Sprintf("http://%s/ answers %d without sending visitors to the secure site.", domain, resp.StatusCode),
				Fix: "Answer every plain-HTTP request with a 301 redirect to the https:// address."})
		default:
			out = append(out, Finding{ID: "http.plaintext_only", Category: CategoryHTTP, Severity: High,
				Title: "The site is served over plain HTTP", Detail: "Everything visitors send and receive can be read and changed on the way.",
				Fix: "Serve the site over HTTPS and redirect HTTP to it."})
		}
	}

	if !httpsUp {
		return out
	}
	resp, _, err := follow(ctx, client, "https://"+domain+"/")
	if err != nil {
		info.Error = cleanNetErr(err)
		return append(out, Finding{ID: "http.https_failed", Category: CategoryHTTP, Severity: Info,
			Title: "The HTTPS site didn't answer", Detail: "Requesting https://" + domain + "/ failed: " + info.Error + ". Header checks were skipped."})
	}
	info.FinalURL = resp.Request.URL.String()
	info.StatusCode = resp.StatusCode
	info.Headers = map[string]string{}
	for _, h := range headersShown {
		if v := resp.Header.Get(h); v != "" {
			info.Headers[h] = clip(v, 300)
		}
	}
	if resp.Request.URL.Scheme != "https" {
		out = append(out, Finding{ID: "http.downgrade", Category: CategoryHTTP, Severity: High,
			Title: "HTTPS redirects back to plain HTTP", Detail: "https://" + domain + "/ ends up at " + info.FinalURL + ".",
			Fix: "Keep every redirect on https://."})
		return out
	}
	out = append(out, analyzeHeaders(resp.Header)...)
	out = append(out, analyzeCookies(resp.Cookies())...)
	return out
}

func clip(s string, n int) string {
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

var maxAgeRe = regexp.MustCompile(`(?i)max-age\s*=\s*"?(\d+)`)
var versionRe = regexp.MustCompile(`/\s*\d`)

// analyzeHeaders checks the security headers of an HTTPS response.
func analyzeHeaders(h http.Header) []Finding {
	var out []Finding
	add := func(f Finding) { f.Category = CategoryHTTP; out = append(out, f) }

	if hsts := h.Get("Strict-Transport-Security"); hsts == "" {
		add(Finding{ID: "http.hsts.missing", Severity: Medium, Title: "No HSTS header",
			Detail: "Browsers may still try plain HTTP first, where the connection can be intercepted.",
			Fix:    "Send Strict-Transport-Security: max-age=31536000; includeSubDomains"})
	} else {
		age := 0
		if m := maxAgeRe.FindStringSubmatch(hsts); m != nil {
			age, _ = strconv.Atoi(m[1])
		}
		if age < hstsMinAge {
			add(Finding{ID: "http.hsts.short", Severity: Low, Title: "HSTS lasts less than six months",
				Detail: fmt.Sprintf("max-age is %d seconds.", age), Fix: "Raise max-age to 31536000 (a year)."})
		} else {
			add(Finding{ID: "http.hsts.ok", Severity: Pass, Title: "HSTS keeps browsers on HTTPS"})
		}
	}

	csp := h.Get("Content-Security-Policy")
	if csp == "" {
		add(Finding{ID: "http.csp.missing", Severity: Medium, Title: "No Content-Security-Policy",
			Detail: "Without a CSP, an injected script runs with the full rights of your site.",
			Fix:    "Add a Content-Security-Policy, starting from default-src 'self' and allowing what the site needs."})
	} else if strings.Contains(csp, "'unsafe-inline'") && !strings.Contains(csp, "'nonce-") && !strings.Contains(csp, "'strict-dynamic'") {
		add(Finding{ID: "http.csp.unsafe_inline", Severity: Low, Title: "CSP allows inline scripts",
			Detail: "'unsafe-inline' lets injected inline scripts run, which undoes most of what a CSP protects.",
			Fix:    "Use nonces or hashes for inline scripts instead of 'unsafe-inline'."})
	} else {
		add(Finding{ID: "http.csp.ok", Severity: Pass, Title: "Content-Security-Policy is set"})
	}

	if h.Get("X-Frame-Options") == "" && !strings.Contains(strings.ToLower(csp), "frame-ancestors") {
		add(Finding{ID: "http.framing", Severity: Low, Title: "Other sites can frame this one",
			Detail: "Without X-Frame-Options or frame-ancestors, the site can be loaded in a hidden frame for clickjacking.",
			Fix:    "Send X-Frame-Options: DENY, or frame-ancestors 'none' in the CSP."})
	} else {
		add(Finding{ID: "http.framing.ok", Severity: Pass, Title: "Framing by other sites is blocked"})
	}

	if !strings.EqualFold(strings.TrimSpace(h.Get("X-Content-Type-Options")), "nosniff") {
		add(Finding{ID: "http.nosniff", Severity: Low, Title: "No X-Content-Type-Options: nosniff",
			Detail: "Browsers may guess a file's type and run an upload as a script.", Fix: "Send X-Content-Type-Options: nosniff"})
	} else {
		add(Finding{ID: "http.nosniff.ok", Severity: Pass, Title: "Content types aren't sniffed"})
	}

	if rp := strings.ToLower(h.Get("Referrer-Policy")); rp == "" || strings.Contains(rp, "unsafe-url") {
		add(Finding{ID: "http.referrer", Severity: Low, Title: "Full URLs may leak to other sites",
			Detail: "Without a Referrer-Policy, links can pass page paths and query strings to the sites they lead to.",
			Fix:    "Send Referrer-Policy: strict-origin-when-cross-origin"})
	} else {
		add(Finding{ID: "http.referrer.ok", Severity: Pass, Title: "Referrer-Policy is set"})
	}

	if h.Get("Permissions-Policy") == "" {
		add(Finding{ID: "http.permissions", Severity: Info, Title: "No Permissions-Policy",
			Detail: "It can switch off camera, microphone, and other features the site doesn't use.",
			Fix:    "Send Permissions-Policy: camera=(), microphone=(), geolocation=()"})
	}

	var leaks []string
	if s := h.Get("Server"); versionRe.MatchString(s) {
		leaks = append(leaks, "Server: "+clip(s, 60))
	}
	if p := h.Get("X-Powered-By"); p != "" {
		leaks = append(leaks, "X-Powered-By: "+clip(p, 60))
	}
	if len(leaks) > 0 {
		add(Finding{ID: "http.version_leak", Severity: Low, Title: "Headers reveal software versions",
			Detail: strings.Join(leaks, "; ") + ". Attackers use versions to pick known exploits.",
			Fix:    "Remove X-Powered-By and the version from the Server header."})
	}
	return out
}

// analyzeCookies flags cookies set without the usual protections.
func analyzeCookies(cookies []*http.Cookie) []Finding {
	var insecure, script, sameSite []string
	for _, c := range cookies {
		if !c.Secure {
			insecure = append(insecure, c.Name)
		}
		if !c.HttpOnly {
			script = append(script, c.Name)
		}
		if c.SameSite == http.SameSiteDefaultMode {
			sameSite = append(sameSite, c.Name)
		}
	}
	var out []Finding
	if len(insecure) > 0 {
		out = append(out, Finding{ID: "http.cookies.secure", Category: CategoryHTTP, Severity: Low,
			Title: "Cookies can be sent over plain HTTP", Detail: "Without Secure: " + list(insecure) + ".", Fix: "Set the Secure flag on every cookie."})
	}
	if len(script) > 0 {
		out = append(out, Finding{ID: "http.cookies.httponly", Category: CategoryHTTP, Severity: Info,
			Title: "Scripts can read some cookies", Detail: "Without HttpOnly: " + list(script) + ". Fine for cookies scripts need; session cookies should have it.",
			Fix: "Set HttpOnly on session and auth cookies."})
	}
	if len(sameSite) > 0 {
		out = append(out, Finding{ID: "http.cookies.samesite", Category: CategoryHTTP, Severity: Info,
			Title: "Some cookies have no SameSite", Detail: "Without SameSite: " + list(sameSite) + ".", Fix: "Set SameSite=Lax (or Strict) on cookies."})
	}
	return out
}

func list(names []string) string {
	if len(names) > 5 {
		return strings.Join(names[:5], ", ") + fmt.Sprintf(" and %d more", len(names)-5)
	}
	return strings.Join(names, ", ")
}
