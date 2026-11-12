// Package passive grades a domain's public security posture from signals
// anyone can see: its TLS certificate and protocol versions, the security
// headers its website sends, and the DNS records that protect its email. It
// never sends anything a normal visitor or mail server wouldn't, so it needs
// no proof of ownership (Tier 0 in the security roadmap).
package passive

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/net/idna"
	"golang.org/x/net/publicsuffix"
)

// Severity of a finding. Pass marks a check that came out well.
type Severity string

const (
	High   Severity = "high"
	Medium Severity = "medium"
	Low    Severity = "low"
	Info   Severity = "info"
	Pass   Severity = "pass"
)

// What each severity costs out of 100.
var penalty = map[Severity]int{High: 25, Medium: 10, Low: 4}

// Finding categories.
const (
	CategoryTLS   = "tls"
	CategoryHTTP  = "http"
	CategoryEmail = "email"
	CategoryDNS   = "dns"
)

// Finding is one thing the scan noticed, with what to do about it.
type Finding struct {
	ID       string   `json:"id"`
	Category string   `json:"category"`
	Severity Severity `json:"severity"`
	Title    string   `json:"title"`
	Detail   string   `json:"detail,omitempty"`
	Fix      string   `json:"fix,omitempty"`
}

// CertInfo describes the certificate the site served.
type CertInfo struct {
	Subject            string    `json:"subject"`
	Issuer             string    `json:"issuer"`
	Names              []string  `json:"names"`
	NotBefore          time.Time `json:"not_before"`
	NotAfter           time.Time `json:"not_after"`
	DaysLeft           int       `json:"days_left"`
	KeyType            string    `json:"key_type"`
	KeyBits            int       `json:"key_bits,omitempty"`
	SignatureAlgorithm string    `json:"signature_algorithm"`
}

// TLSInfo is what the HTTPS handshake showed.
type TLSInfo struct {
	Available      bool      `json:"available"`
	Version        string    `json:"version,omitempty"`
	Cipher         string    `json:"cipher,omitempty"`
	Trusted        bool      `json:"trusted"`
	TrustError     string    `json:"trust_error,omitempty"`
	LegacyAccepted bool      `json:"legacy_accepted"`
	Cert           *CertInfo `json:"cert,omitempty"`
	Error          string    `json:"error,omitempty"`
}

// HTTPInfo is what the website answered.
type HTTPInfo struct {
	FinalURL         string            `json:"final_url,omitempty"`
	StatusCode       int               `json:"status_code,omitempty"`
	RedirectsToHTTPS *bool             `json:"redirects_to_https,omitempty"`
	Headers          map[string]string `json:"headers,omitempty"`
	Error            string            `json:"error,omitempty"`
}

// DNSInfo is what the DNS lookups found.
type DNSInfo struct {
	Addresses  []string `json:"addresses"`
	MX         []string `json:"mx"`
	SPF        []string `json:"spf"`
	DMARC      string   `json:"dmarc,omitempty"`
	DMARCFrom  string   `json:"dmarc_from,omitempty"`
	CAA        []string `json:"caa"`
	CAAFrom    string   `json:"caa_from,omitempty"`
	DNSSEC     bool     `json:"dnssec"`
	OrgDomain  string   `json:"org_domain"`
	LookupErrs []string `json:"lookup_errors,omitempty"`
}

// Report is the result of one scan.
type Report struct {
	Domain     string           `json:"domain"`
	Grade      string           `json:"grade"`
	Score      int              `json:"score"`
	Counts     map[Severity]int `json:"counts"`
	Findings   []Finding        `json:"findings"`
	TLS        TLSInfo          `json:"tls"`
	HTTP       HTTPInfo         `json:"http"`
	DNS        DNSInfo          `json:"dns"`
	CheckedAt  time.Time        `json:"checked_at"`
	DurationMs float64          `json:"duration_ms"`
}

// Config tunes a scan.
type Config struct {
	// Timeout bounds each network step; DefaultTimeout when zero.
	Timeout time.Duration
	// CheckHost vets the domain's addresses before anything connects, and
	// DialControl vets every connection, redirects included. The API sets
	// both from its SSRF policy.
	CheckHost   func(ctx context.Context, host string) error
	DialControl func(network, address string, c syscall.RawConn) error
	// Resolvers are DNS servers as host:port; public resolvers when empty.
	Resolvers []string
	// RootCAs overrides the system roots; tests use it for their own server.
	RootCAs *x509.CertPool

	// Tests point the scan at local servers.
	dialContext func(ctx context.Context, network, address string) (net.Conn, error)
	lookup      func(ctx context.Context, name string, qtype uint16) ([]string, error)
}

// DefaultTimeout bounds each network step of a scan.
const DefaultTimeout = 8 * time.Second

var defaultResolvers = []string{"1.1.1.1:53", "8.8.8.8:53", "9.9.9.9:53"}

// NormalizeDomain accepts a domain, or a URL, and returns the lowercase
// ASCII host name. IP addresses are refused: these checks are about names.
func NormalizeDomain(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", errors.New("enter a domain, like example.com")
	}
	if i := strings.Index(s, "://"); i >= 0 {
		s = s[i+3:]
	}
	if i := strings.IndexAny(s, "/?#"); i >= 0 {
		s = s[:i]
	}
	if i := strings.LastIndex(s, "@"); i >= 0 {
		s = s[i+1:]
	}
	if h, _, err := net.SplitHostPort(s); err == nil {
		s = h
	}
	s = strings.TrimSuffix(strings.ToLower(s), ".")
	if _, err := netip.ParseAddr(strings.Trim(s, "[]")); err == nil {
		return "", errors.New("enter a domain name, not an IP address")
	}
	ascii, err := idna.Lookup.ToASCII(s)
	if err != nil {
		return "", fmt.Errorf("%q isn't a valid domain", raw)
	}
	if len(ascii) > 253 || !strings.Contains(ascii, ".") {
		return "", fmt.Errorf("%q isn't a valid domain", raw)
	}
	for _, label := range strings.Split(ascii, ".") {
		if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return "", fmt.Errorf("%q isn't a valid domain", raw)
		}
		for _, r := range label {
			if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
				return "", fmt.Errorf("%q isn't a valid domain", raw)
			}
		}
	}
	if suffix, _ := publicsuffix.PublicSuffix(ascii); suffix == ascii {
		return "", fmt.Errorf("%s is a public suffix, not a domain anyone owns", ascii)
	}
	return ascii, nil
}

// Run scans a domain. It fails only when the domain can't be scanned at all,
// such as when it doesn't exist or resolves to an address the policy blocks;
// anything else becomes a finding.
func Run(ctx context.Context, rawDomain string, cfg Config) (Report, error) {
	domain, err := NormalizeDomain(rawDomain)
	if err != nil {
		return Report{}, err
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = DefaultTimeout
	}
	if len(cfg.Resolvers) == 0 {
		cfg.Resolvers = defaultResolvers
	}
	start := time.Now()
	rep := Report{Domain: domain, CheckedAt: start.UTC()}

	r := newResolver(cfg)
	addrs, aErr := r.addresses(ctx, domain)
	mx, mxErr := r.txtLike(ctx, domain, typeMX)
	if len(addrs) == 0 && len(mx) == 0 {
		if aErr != nil && ctx.Err() != nil {
			return Report{}, ctx.Err()
		}
		return Report{}, fmt.Errorf("%s has no web or mail servers in DNS; check the spelling", domain)
	}
	if len(addrs) > 0 && cfg.CheckHost != nil {
		if err := cfg.CheckHost(ctx, domain); err != nil {
			return Report{}, fmt.Errorf("%s can't be scanned: %w", domain, err)
		}
	}
	rep.DNS.Addresses = addrs
	rep.DNS.MX = mx
	if mxErr != nil {
		rep.DNS.LookupErrs = append(rep.DNS.LookupErrs, "MX: "+mxErr.Error())
	}

	var findings []Finding
	var mu sync.Mutex
	add := func(f ...Finding) {
		mu.Lock()
		findings = append(findings, f...)
		mu.Unlock()
	}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		add(checkDNS(ctx, r, domain, &rep.DNS)...)
	}()
	if len(addrs) > 0 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			add(checkTLS(ctx, cfg, domain, &rep.TLS)...)
			add(checkHTTP(ctx, cfg, domain, rep.TLS.Available, &rep.HTTP)...)
		}()
	} else {
		add(Finding{ID: "web.none", Category: CategoryHTTP, Severity: Info, Title: "No website on this name",
			Detail: domain + " has mail servers but no web address, so the HTTPS and header checks were skipped."})
	}
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return Report{}, fmt.Errorf("the scan of %s took too long", domain)
	}

	rep.Findings = sortFindings(findings)
	rep.Score, rep.Grade, rep.Counts = grade(rep.Findings)
	rep.DurationMs = float64(time.Since(start).Microseconds()) / 1000
	return rep, nil
}

func sortFindings(fs []Finding) []Finding {
	order := map[Severity]int{High: 0, Medium: 1, Low: 2, Info: 3, Pass: 4}
	cat := map[string]int{CategoryTLS: 0, CategoryHTTP: 1, CategoryEmail: 2, CategoryDNS: 3}
	slices.SortStableFunc(fs, func(a, b Finding) int {
		if d := order[a.Severity] - order[b.Severity]; d != 0 {
			return d
		}
		if d := cat[a.Category] - cat[b.Category]; d != 0 {
			return d
		}
		return strings.Compare(a.ID, b.ID)
	})
	if fs == nil {
		fs = []Finding{}
	}
	return fs
}

// grade turns findings into a score out of 100 and a letter. A high-severity
// finding alone is enough to keep a domain out of the A and B grades.
func grade(fs []Finding) (int, string, map[Severity]int) {
	counts := map[Severity]int{High: 0, Medium: 0, Low: 0, Info: 0, Pass: 0}
	score := 100
	for _, f := range fs {
		counts[f.Severity]++
		score -= penalty[f.Severity]
	}
	score = max(score, 0)
	letter := "F"
	switch {
	case score == 100:
		letter = "A+"
	case score >= 90:
		letter = "A"
	case score >= 80:
		letter = "B"
	case score >= 65:
		letter = "C"
	case score >= 50:
		letter = "D"
	}
	if counts[High] > 0 && (letter == "A+" || letter == "A" || letter == "B") {
		letter = "C"
	}
	return score, letter, counts
}

// Grade scores findings the way a passive check does: a score out of 100, a
// letter, and how many of each severity there were.
func Grade(fs []Finding) (int, string, map[Severity]int) { return grade(fs) }

// SortFindings orders findings worst first.
func SortFindings(fs []Finding) []Finding { return sortFindings(fs) }

// InspectTLS runs only the TLS part of a passive check against host:443.
func InspectTLS(ctx context.Context, host string, cfg Config) (TLSInfo, []Finding) {
	if cfg.Timeout <= 0 {
		cfg.Timeout = DefaultTimeout
	}
	var info TLSInfo
	findings := checkTLS(ctx, cfg, host, &info)
	return info, findings
}
