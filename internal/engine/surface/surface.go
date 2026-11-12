// Package surface maps what a verified domain exposes to the internet: its
// subdomains, the addresses they point to, the common service ports open on
// them, and their certificates. It is Tier 1: callers must check that the
// workspace has proved it owns the domain before running it.
package surface

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/miekg/dns"

	"qnetward/internal/engine/passive"
)

// MaxHosts caps the names one scan looks at.
const MaxHosts = 100

// commonNames are tried on top of what certificate logs show.
var commonNames = []string{
	"www", "mail", "smtp", "imap", "pop", "webmail", "mx", "api", "app", "apps", "admin", "portal", "dashboard",
	"dev", "staging", "stage", "test", "qa", "uat", "beta", "demo", "sandbox", "internal", "intranet", "vpn",
	"remote", "git", "gitlab", "jenkins", "ci", "grafana", "kibana", "monitor", "status", "docs", "blog", "shop",
	"cdn", "static", "assets", "media", "files", "ftp", "db", "sql", "auth", "sso", "login", "m", "old", "legacy",
}

// Port is a TCP port worth knowing about, and what an open one means.
type Port struct {
	Number   int
	Service  string
	Severity passive.Severity
	Why      string
}

// Ports are the service ports checked on every host.
var Ports = []Port{
	{21, "FTP", passive.Medium, "FTP sends passwords in the clear."},
	{22, "SSH", passive.Low, "Fine with keys only, but a target for password guessing."},
	{23, "Telnet", passive.High, "Telnet sends everything, passwords included, in the clear."},
	{25, "SMTP", passive.Info, "Expected on mail servers."},
	{80, "HTTP", passive.Info, ""},
	{443, "HTTPS", passive.Info, ""},
	{445, "SMB", passive.High, "Windows file sharing is a common way into networks and should never face the internet."},
	{1433, "SQL Server", passive.High, "Databases should only be reachable from your own servers."},
	{1521, "Oracle", passive.High, "Databases should only be reachable from your own servers."},
	{2375, "Docker API", passive.High, "An open Docker API gives full control of the host."},
	{3306, "MySQL", passive.High, "Databases should only be reachable from your own servers."},
	{3389, "Remote Desktop", passive.High, "RDP facing the internet is a leading cause of ransomware."},
	{5432, "PostgreSQL", passive.High, "Databases should only be reachable from your own servers."},
	{5900, "VNC", passive.High, "VNC often has weak or no authentication."},
	{6379, "Redis", passive.High, "Redis has no authentication by default."},
	{8080, "HTTP alt", passive.Low, "Often a development or admin server left open."},
	{8443, "HTTPS alt", passive.Low, "Often an admin panel or appliance interface."},
	{9200, "Elasticsearch", passive.High, "Elasticsearch has leaked many databases; it should never be public."},
	{11211, "Memcached", passive.High, "Memcached has no authentication and is abused for DDoS amplification."},
	{27017, "MongoDB", passive.High, "Databases should only be reachable from your own servers."},
}

// takeoverTargets are services where a CNAME to a removed resource lets
// anyone claim the name.
var takeoverTargets = []string{
	".herokuapp.com", ".herokudns.com", ".github.io", ".s3.amazonaws.com", ".s3-website", ".azurewebsites.net",
	".cloudapp.net", ".trafficmanager.net", ".blob.core.windows.net", ".cloudfront.net", ".netlify.app",
	".vercel.app", ".pantheonsite.io", ".ghost.io", ".myshopify.com", ".surge.sh", ".bitbucket.io", ".fly.dev",
	".readthedocs.io", ".zendesk.com", ".wpengine.com", ".unbouncepages.com",
}

var riskyLabels = []string{"dev", "staging", "stage", "test", "qa", "uat", "sandbox", "internal", "intranet", "admin", "jenkins", "grafana", "kibana", "old", "legacy", "db", "sql"}

// Finding is a passive.Finding about one host.
type Finding struct {
	passive.Finding
	Host string `json:"host"`
}

// Host is one name and what is reachable on it.
type Host struct {
	Name       string     `json:"name"`
	Source     string     `json:"source"`
	Addresses  []string   `json:"addresses"`
	CNAME      string     `json:"cname,omitempty"`
	Private    bool       `json:"private,omitempty"`
	OpenPorts  []int      `json:"open_ports"`
	TLSVersion string     `json:"tls_version,omitempty"`
	CertExpiry *time.Time `json:"cert_expiry,omitempty"`
	CertIssuer string     `json:"cert_issuer,omitempty"`
}

// Report is the result of one scan.
type Report struct {
	Domain     string                   `json:"domain"`
	Grade      string                   `json:"grade"`
	Score      int                      `json:"score"`
	Counts     map[passive.Severity]int `json:"counts"`
	Findings   []Finding                `json:"findings"`
	Hosts      []Host                   `json:"hosts"`
	Truncated  bool                     `json:"truncated,omitempty"`
	CTError    string                   `json:"ct_error,omitempty"`
	CheckedAt  time.Time                `json:"checked_at"`
	DurationMs float64                  `json:"duration_ms"`
}

// Config tunes a scan.
type Config struct {
	// CheckAddr vets every address before anything connects to it; the API
	// passes its SSRF policy. Hosts on blocked addresses are listed, not probed.
	CheckAddr   func(netip.Addr) error
	DialControl func(network, address string, c syscall.RawConn) error
	Resolvers   []string
	// PortTimeout bounds each connect; 2 seconds when zero.
	PortTimeout time.Duration
	// CTURL is the certificate-log search; crt.sh when empty.
	CTURL string

	// Tests replace the network.
	lookup  func(ctx context.Context, name string, qtype uint16) ([]string, bool, error)
	dial    func(ctx context.Context, network, address string) (net.Conn, error)
	skipTLS bool
}

var defaultResolvers = []string{"1.1.1.1:53", "8.8.8.8:53", "9.9.9.9:53"}

// Run maps the domain's surface. It never fails for a single host; it fails
// only when the context ends first.
func Run(ctx context.Context, domain string, cfg Config) (Report, error) {
	if len(cfg.Resolvers) == 0 {
		cfg.Resolvers = defaultResolvers
	}
	if cfg.PortTimeout <= 0 {
		cfg.PortTimeout = 2 * time.Second
	}
	if cfg.lookup == nil {
		cfg.lookup = func(ctx context.Context, name string, qtype uint16) ([]string, bool, error) {
			return query(ctx, cfg.Resolvers, name, qtype)
		}
	}
	if cfg.dial == nil {
		d := &net.Dialer{Timeout: cfg.PortTimeout, Control: cfg.DialControl}
		cfg.dial = d.DialContext
	}
	start := time.Now()
	rep := Report{Domain: domain, CheckedAt: start.UTC()}

	names := map[string]string{domain: "domain"}
	ctNames, ctErr := fromCertLogs(ctx, domain, cfg)
	if ctErr != nil {
		rep.CTError = ctErr.Error()
	}
	for _, n := range ctNames {
		if _, ok := names[n]; !ok {
			names[n] = "certificate logs"
		}
	}
	for _, label := range commonNames {
		n := label + "." + domain
		if _, ok := names[n]; !ok {
			names[n] = "common name"
		}
	}
	ordered := make([]string, 0, len(names))
	for n := range names {
		ordered = append(ordered, n)
	}
	// The domain, then names from certificates, then guesses; each A–Z.
	rank := map[string]int{"domain": 0, "certificate logs": 1, "common name": 2}
	slices.SortFunc(ordered, func(a, b string) int {
		if d := rank[names[a]] - rank[names[b]]; d != 0 {
			return d
		}
		return strings.Compare(a, b)
	})

	// Resolve every candidate; only names that exist (or dangle) are kept.
	type resolved struct {
		host     Host
		findings []Finding
		keep     bool
	}
	results := make([]resolved, len(ordered))
	sem := make(chan struct{}, 16)
	var wg sync.WaitGroup
	for i, name := range ordered {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, name string) {
			defer wg.Done()
			defer func() { <-sem }()
			h, fs, keep := resolveHost(ctx, cfg, name, names[name])
			results[i] = resolved{h, fs, keep}
		}(i, name)
	}
	wg.Wait()
	if ctx.Err() != nil {
		return Report{}, errors.New("the scan took too long")
	}

	var findings []Finding
	for _, r := range results {
		if !r.keep {
			continue
		}
		if len(rep.Hosts) >= MaxHosts {
			rep.Truncated = true
			break
		}
		rep.Hosts = append(rep.Hosts, r.host)
		findings = append(findings, r.findings...)
	}

	// Probe ports and TLS on hosts with public addresses.
	var mu sync.Mutex
	hostSem := make(chan struct{}, 6)
	for i := range rep.Hosts {
		h := &rep.Hosts[i]
		if h.Private || len(h.Addresses) == 0 {
			continue
		}
		wg.Add(1)
		hostSem <- struct{}{}
		go func(h *Host) {
			defer wg.Done()
			defer func() { <-hostSem }()
			fs := probeHost(ctx, cfg, h)
			mu.Lock()
			findings = append(findings, fs...)
			mu.Unlock()
		}(h)
	}
	wg.Wait()
	if ctx.Err() != nil {
		return Report{}, errors.New("the scan took too long")
	}

	if rep.Hosts == nil {
		rep.Hosts = []Host{}
	}
	rep.Findings = sortFindings(findings)
	plain := make([]passive.Finding, len(rep.Findings))
	for i, f := range rep.Findings {
		plain[i] = f.Finding
	}
	rep.Score, rep.Grade, rep.Counts = passive.Grade(plain)
	rep.DurationMs = float64(time.Since(start).Microseconds()) / 1000
	return rep, nil
}

func sortFindings(fs []Finding) []Finding {
	if fs == nil {
		return []Finding{}
	}
	order := map[passive.Severity]int{passive.High: 0, passive.Medium: 1, passive.Low: 2, passive.Info: 3, passive.Pass: 4}
	slices.SortStableFunc(fs, func(a, b Finding) int {
		if d := order[a.Severity] - order[b.Severity]; d != 0 {
			return d
		}
		if d := strings.Compare(a.Host, b.Host); d != 0 {
			return d
		}
		return strings.Compare(a.ID, b.ID)
	})
	return fs
}

// resolveHost looks a name up. A name with no address is kept only when its
// CNAME dangles at a service someone else could claim.
func resolveHost(ctx context.Context, cfg Config, name, source string) (Host, []Finding, bool) {
	h := Host{Name: name, Source: source, OpenPorts: []int{}}
	cname, _, _ := cfg.lookup(ctx, name, dns.TypeCNAME)
	if len(cname) > 0 {
		h.CNAME = strings.TrimSuffix(cname[0], ".")
	}
	v4, _, _ := cfg.lookup(ctx, name, dns.TypeA)
	v6, _, _ := cfg.lookup(ctx, name, dns.TypeAAAA)
	h.Addresses = append(v4, v6...)

	var out []Finding
	if len(h.Addresses) == 0 {
		if h.CNAME == "" || !takeoverService(h.CNAME) {
			return h, nil, false
		}
		// The target is gone: whoever creates it there gets this name.
		if _, nx, _ := cfg.lookup(ctx, h.CNAME, dns.TypeA); nx {
			out = append(out, Finding{Host: name, Finding: passive.Finding{
				ID: "surface.takeover", Category: passive.CategoryDNS, Severity: passive.High,
				Title:  "Possible subdomain takeover",
				Detail: fmt.Sprintf("%s points to %s, which no longer exists. Anyone who creates that resource can serve content on your name.", name, h.CNAME),
				Fix:    "Delete the CNAME record, or create the resource it points to again.",
			}})
			h.Addresses = []string{}
			return h, out, true
		}
		return h, nil, false
	}
	for _, a := range h.Addresses {
		addr, err := netip.ParseAddr(a)
		if err == nil && cfg.CheckAddr != nil && cfg.CheckAddr(addr) != nil {
			h.Private = true
		}
	}
	if h.Private {
		out = append(out, Finding{Host: name, Finding: passive.Finding{
			ID: "surface.private_dns", Category: passive.CategoryDNS, Severity: passive.Low,
			Title:  "Public DNS reveals an internal address",
			Detail: fmt.Sprintf("%s resolves to %s for anyone who asks, which maps out your internal network. It wasn't probed.", name, strings.Join(h.Addresses, ", ")),
			Fix:    "Serve internal names from internal DNS only.",
		}})
	}
	first := strings.SplitN(strings.TrimSuffix(name, "."), ".", 2)[0]
	for _, label := range riskyLabels {
		if first == label || strings.HasPrefix(first, label+"-") || strings.HasSuffix(first, "-"+label) {
			out = append(out, Finding{Host: name, Finding: passive.Finding{
				ID: "surface.sensitive_name", Category: passive.CategoryDNS, Severity: passive.Info,
				Title:  "Non-production or admin name is public",
				Detail: name + " looks like a development, test, or admin system. These are often less hardened than production.",
				Fix:    "Put it behind a VPN or single sign-on, or remove it if it's unused.",
			}})
			break
		}
	}
	return h, out, true
}

func takeoverService(target string) bool {
	t := strings.ToLower(target)
	for _, s := range takeoverTargets {
		if strings.HasSuffix(t, s) || strings.Contains(t, s+".") {
			return true
		}
	}
	return false
}

// probeHost checks the common ports on the host's first address, then TLS.
func probeHost(ctx context.Context, cfg Config, h *Host) []Finding {
	addr := h.Addresses[0]
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for _, p := range Ports {
		wg.Add(1)
		sem <- struct{}{}
		go func(p Port) {
			defer wg.Done()
			defer func() { <-sem }()
			pctx, cancel := context.WithTimeout(ctx, cfg.PortTimeout)
			defer cancel()
			conn, err := cfg.dial(pctx, "tcp", net.JoinHostPort(addr, strconv.Itoa(p.Number)))
			if err != nil {
				return
			}
			conn.Close()
			mu.Lock()
			h.OpenPorts = append(h.OpenPorts, p.Number)
			mu.Unlock()
		}(p)
	}
	wg.Wait()
	slices.Sort(h.OpenPorts)

	var out []Finding
	open := func(n int) bool { return slices.Contains(h.OpenPorts, n) }
	for _, p := range Ports {
		if !open(p.Number) || p.Severity == passive.Info {
			continue
		}
		out = append(out, Finding{Host: h.Name, Finding: passive.Finding{
			ID: "surface.port." + strconv.Itoa(p.Number), Category: "exposure", Severity: p.Severity,
			Title:  fmt.Sprintf("%s (port %d) is open to the internet", p.Service, p.Number),
			Detail: p.Why,
			Fix:    "Close the port in the firewall or security group, or allow only the addresses that need it.",
		}})
	}
	if open(80) && !open(443) {
		out = append(out, Finding{Host: h.Name, Finding: passive.Finding{
			ID: "surface.http_only", Category: passive.CategoryHTTP, Severity: passive.Medium,
			Title: "Serves plain HTTP only", Detail: h.Name + " answers on port 80 but not 443.",
			Fix: "Serve it over HTTPS, or close port 80 if it's unused.",
		}})
	}
	if open(443) && !cfg.skipTLS {
		info, fs := passive.InspectTLS(ctx, h.Name, passive.Config{Timeout: 6 * time.Second, DialControl: cfg.DialControl, Resolvers: cfg.Resolvers})
		h.TLSVersion = info.Version
		if info.Cert != nil {
			exp := info.Cert.NotAfter
			h.CertExpiry, h.CertIssuer = &exp, info.Cert.Issuer
		}
		for _, f := range fs {
			// Per-host TLS problems that matter; the rest are in the passive check.
			switch f.ID {
			case "tls.cert.expired", "tls.cert.untrusted", "tls.cert.expiring", "tls.legacy_only", "tls.legacy":
				out = append(out, Finding{Host: h.Name, Finding: f})
			}
		}
	}
	return out
}

// fromCertLogs lists names under domain seen in public certificate logs.
// crt.sh is busy at times, so a server error gets one more try.
func fromCertLogs(ctx context.Context, domain string, cfg Config) ([]string, error) {
	names, err := fetchCertLogs(ctx, domain, cfg)
	if err != nil && ctx.Err() == nil && strings.Contains(err.Error(), "answered 5") {
		select {
		case <-ctx.Done():
		case <-time.After(3 * time.Second):
			names, err = fetchCertLogs(ctx, domain, cfg)
		}
	}
	return names, err
}

func fetchCertLogs(ctx context.Context, domain string, cfg Config) ([]string, error) {
	base := cfg.CTURL
	if base == "" {
		base = "https://crt.sh/"
	}
	u := base + "?q=" + url.QueryEscape("%."+domain) + "&output=json&exclude=expired"
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Qnetward-AttackSurface/1.0 (+https://qnetward.com)")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("certificate logs didn't answer: %w", errors.Unwrap(err))
	}
	defer resp.Body.Close()
	// crt.sh answers 404 when no certificate names the domain.
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("certificate logs answered %d", resp.StatusCode)
	}
	var rows []struct {
		NameValue string `json:"name_value"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&rows); err != nil {
		return nil, fmt.Errorf("certificate logs sent an unreadable answer")
	}
	seen := map[string]bool{}
	var out []string
	for _, r := range rows {
		for _, n := range strings.Split(r.NameValue, "\n") {
			n = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(n)), "*.")
			if n == "" || seen[n] || (n != domain && !strings.HasSuffix(n, "."+domain)) || strings.ContainsAny(n, " @*") {
				continue
			}
			seen[n] = true
			out = append(out, n)
		}
	}
	return out, nil
}

// query returns answers of qtype as text, and whether the name doesn't exist.
func query(ctx context.Context, servers []string, name string, qtype uint16) ([]string, bool, error) {
	msg := new(dns.Msg)
	msg.SetQuestion(dns.Fqdn(name), qtype)
	var lastErr error
	for _, server := range servers {
		resp, _, err := (&dns.Client{Timeout: 3 * time.Second}).ExchangeContext(ctx, msg, server)
		if err != nil {
			if ctx.Err() != nil {
				return nil, false, ctx.Err()
			}
			lastErr = err
			continue
		}
		if resp.Rcode == dns.RcodeNameError {
			return nil, true, nil
		}
		if resp.Rcode != dns.RcodeSuccess {
			lastErr = fmt.Errorf("%s", dns.RcodeToString[resp.Rcode])
			continue
		}
		var out []string
		for _, rr := range resp.Answer {
			if rr.Header().Rrtype != qtype {
				continue
			}
			switch v := rr.(type) {
			case *dns.A:
				out = append(out, v.A.String())
			case *dns.AAAA:
				out = append(out, v.AAAA.String())
			case *dns.CNAME:
				out = append(out, v.Target)
			}
		}
		return out, false, nil
	}
	return nil, false, lastErr
}
