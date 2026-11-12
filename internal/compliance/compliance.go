// Package compliance maps what Qnetward's scans have seen onto controls from
// common frameworks. It only covers what can be observed from outside, so a
// result is evidence for an auditor, never an attestation.
package compliance

import (
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"qnetward/internal/engine/passive"
)

// Status is how a control stands.
type Status string

const (
	Pass        Status = "pass"
	Warn        Status = "warn"
	Fail        Status = "fail"
	NotAssessed Status = "not_assessed"
)

// Framework is a standard whose requirements controls refer to.
type Framework struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Short string `json:"short"`
}

// Frameworks are the standards controls are mapped to.
var Frameworks = []Framework{
	{ID: "cis", Name: "CIS Critical Security Controls v8", Short: "CIS v8"},
	{ID: "pci", Name: "PCI DSS 4.0", Short: "PCI DSS"},
	{ID: "iso", Name: "ISO/IEC 27001:2022 Annex A", Short: "ISO 27001"},
	{ID: "soc2", Name: "SOC 2 Trust Services Criteria", Short: "SOC 2"},
}

// Finding is one thing a scan noticed, with where it came from.
type Finding struct {
	Kind     string           `json:"kind"`
	Domain   string           `json:"domain"`
	Host     string           `json:"host,omitempty"`
	ID       string           `json:"id"`
	Title    string           `json:"title"`
	Severity passive.Severity `json:"severity"`
	ScanID   int64            `json:"scan_id,omitempty"`
	At       time.Time        `json:"at"`
}

// Scan is the newest scan of one kind for one domain, with its findings.
type Scan struct {
	Kind     string
	Domain   string
	ScanID   int64
	At       time.Time
	Findings []Finding
}

// Vuln is a known vulnerability on a host and what the workspace decided.
type Vuln struct {
	Domain   string
	Host     string
	CVE      string
	Severity string // critical, high, medium, low
	KEV      bool
	Summary  string
	Decision string // "", accepted, false_positive
	ScanID   int64
	At       time.Time
}

// Domain is a domain the workspace added for ownership checks.
type Domain struct {
	Domain   string
	Verified bool
}

// Watch is a scheduled re-check.
type Watch struct {
	Kind          string
	Domain        string
	IntervalHours int
	Enabled       bool
}

// Input is everything the evaluation looks at.
type Input struct {
	Scans    []Scan
	Vulns    []Vuln
	Domains  []Domain
	Watches  []Watch
	Monitors int  // enabled uptime monitors
	Alerting bool // monitors notify someone
	Now      time.Time
}

// Control is a check this product can make evidence for.
type Control struct {
	ID          string              `json:"id"`
	Title       string              `json:"title"`
	Description string              `json:"description"`
	Area        string              `json:"area"`
	Refs        map[string][]string `json:"refs"`
	Fix         string              `json:"fix"`
	// sources are the scan kinds that assess the control; prefixes pick the
	// findings that count against it.
	sources  []string
	prefixes []string
	// needs is "web" when the control only applies to a domain with a
	// website, or "tls" when it also needs HTTPS to answer.
	needs  string
	custom func(in Input, c Control) Result
}

// Result is a control's status and the evidence behind it.
type Result struct {
	Control
	Status   Status    `json:"status"`
	Summary  string    `json:"summary"`
	Evidence []Finding `json:"evidence"`
	Domains  []string  `json:"domains"`
}

// FrameworkScore is how a framework's mapped controls stand.
type FrameworkScore struct {
	Framework
	Mapped      int `json:"mapped"`
	Assessed    int `json:"assessed"`
	Passing     int `json:"passing"`
	Warning     int `json:"warning"`
	Failing     int `json:"failing"`
	NotAssessed int `json:"not_assessed"`
	Percent     int `json:"percent"`
}

// Report is the whole evaluation.
type Report struct {
	Frameworks []FrameworkScore `json:"frameworks"`
	Controls   []Result         `json:"controls"`
	Counts     map[Status]int   `json:"counts"`
	Sources    []Source         `json:"sources"`
	Window     int              `json:"window_days"`
	CheckedAt  time.Time        `json:"checked_at"`
}

// Source is a scan used as evidence.
type Source struct {
	Kind   string    `json:"kind"`
	Domain string    `json:"domain"`
	ScanID int64     `json:"scan_id"`
	At     time.Time `json:"at"`
}

// Window is how old a scan may be and still count as evidence.
const Window = 30 * 24 * time.Hour

func refs(cis, pci, iso, soc2 string) map[string][]string {
	out := map[string][]string{}
	for k, v := range map[string]string{"cis": cis, "pci": pci, "iso": iso, "soc2": soc2} {
		if v != "" {
			out[k] = strings.Split(v, ",")
		}
	}
	return out
}

// Controls are the controls evaluated, in display order.
var Controls = []Control{
	{
		ID: "transport-encryption", Area: "Encryption in transit", Title: "Websites use encrypted connections",
		Description: "Every website answers over HTTPS, with a certificate, so nothing travels in the clear.",
		Fix:         "Serve every site over HTTPS. Free certificates from Let's Encrypt or your CDN cover most cases.",
		Refs:        refs("3.10", "4.2.1", "A.8.24", "CC6.7"),
		sources:     []string{"passive", "surface"},
		prefixes:    []string{"tls.unavailable", "tls.no_cert", "http.plaintext_only", "http.https_failed", "surface.http_only"},
	},
	{
		ID: "tls-protocols", Area: "Encryption in transit", Title: "Only modern TLS versions",
		Description: "TLS 1.0 and 1.1 are switched off; servers offer TLS 1.2 or 1.3.",
		Fix:         "Disable TLS 1.0 and 1.1 in the server or load balancer and keep TLS 1.2 and 1.3.",
		Refs:        refs("3.10", "4.2.1", "A.8.24", "CC6.7"),
		sources:     []string{"passive", "surface"},
		prefixes:    []string{"tls.legacy", "tls.versions"},
		needs:       "tls",
	},
	{
		ID: "certificates", Area: "Encryption in transit", Title: "Certificates are valid and strong",
		Description: "Certificates are trusted, not expired or about to expire, and use strong keys and signatures.",
		Fix:         "Renew certificates automatically and replace any with weak keys or SHA-1 signatures.",
		Refs:        refs("3.10", "4.2.1", "A.8.24", "CC6.7"),
		sources:     []string{"passive", "surface"},
		prefixes:    []string{"tls.cert."},
		needs:       "tls",
	},
	{
		ID: "https-enforced", Area: "Encryption in transit", Title: "HTTPS is enforced",
		Description: "Plain HTTP redirects to HTTPS and HSTS tells browsers never to downgrade.",
		Fix:         "Redirect port 80 to HTTPS and send Strict-Transport-Security with a max-age of at least six months.",
		Refs:        refs("3.10", "4.2.1", "A.8.24", "CC6.7"),
		sources:     []string{"passive"},
		prefixes:    []string{"http.redirect.", "http.hsts.", "http.downgrade", "tls.unavailable", "tls.no_cert", "http.plaintext_only"},
		needs:       "web",
	},
	{
		ID: "browser-protections", Area: "Application security", Title: "Browser security headers are set",
		Description: "Content-Security-Policy, framing protection, nosniff, and a referrer policy limit what a compromised or malicious page can do.",
		Fix:         "Add the missing headers at the web server, CDN, or application framework.",
		Refs:        refs("16.10", "6.2.4", "A.8.26", "CC6.6"),
		sources:     []string{"passive"},
		prefixes:    []string{"http.csp.", "http.framing", "http.nosniff", "http.referrer", "http.permissions"},
		needs:       "web",
	},
	{
		ID: "cookies", Area: "Application security", Title: "Cookies are protected",
		Description: "Cookies set by the site are Secure, HttpOnly, and carry a SameSite policy.",
		Fix:         "Set the Secure, HttpOnly, and SameSite attributes on session cookies.",
		Refs:        refs("16.10", "6.2.4", "A.8.26", "CC6.1"),
		sources:     []string{"passive"},
		prefixes:    []string{"http.cookies."},
		needs:       "web",
	},
	{
		ID: "version-disclosure", Area: "Secure configuration", Title: "Servers don't reveal software versions",
		Description: "Response headers don't name exact server or framework versions, which tells attackers what to try.",
		Fix:         "Turn off version banners, such as server_tokens off in nginx or ServerTokens Prod in Apache.",
		Refs:        refs("4.1", "2.2.1", "A.8.9", "CC7.1"),
		sources:     []string{"passive"},
		prefixes:    []string{"http.version_leak"},
		needs:       "web",
	},
	{
		ID: "email-authentication", Area: "Email security", Title: "Email senders are authenticated",
		Description: "SPF lists who may send for the domain and an enforced DMARC policy tells receivers to reject spoofed mail.",
		Fix:         "Publish SPF ending in -all and move DMARC to p=quarantine or p=reject once reports look clean.",
		Refs:        refs("9.5", "5.4.1", "A.5.14", "CC6.6"),
		sources:     []string{"passive"},
		prefixes:    []string{"email.spf.", "email.dmarc."},
	},
	{
		ID: "dns-integrity", Area: "DNS", Title: "DNS is signed and certificate issuance is restricted",
		Description: "DNSSEC protects answers from tampering and CAA limits which authorities may issue certificates.",
		Fix:         "Enable DNSSEC at your DNS provider and registrar, and publish CAA records for the CAs you use.",
		Refs:        refs("", "", "A.8.20", "CC6.6"),
		sources:     []string{"passive"},
		prefixes:    []string{"dns.dnssec.", "dns.caa."},
	},
	{
		ID: "asset-inventory", Area: "Asset management", Title: "Internet-facing assets are inventoried",
		Description: "Domains are verified and their subdomains and services were discovered by an attack surface scan in the last 30 days.",
		Fix:         "Verify each domain on the Assets page and run an attack surface scan on it.",
		Refs:        refs("1.1", "12.5.1", "A.5.9", "CC6.1"),
		custom:      inventory,
	},
	{
		ID: "exposed-services", Area: "Network exposure", Title: "No risky services face the internet",
		Description: "Databases, remote desktop, file sharing, and admin services are not reachable from the internet.",
		Fix:         "Close the ports at the firewall or security group, or put the service behind a VPN.",
		Refs:        refs("4.8", "1.2.5", "A.8.20", "CC6.6"),
		sources:     []string{"surface"},
		prefixes:    []string{"surface.port."},
	},
	{
		ID: "dangling-dns", Area: "Asset management", Title: "No dangling or leaky DNS records",
		Description: "No subdomain points at a removed cloud resource that someone else could claim, and public DNS doesn't reveal private addresses.",
		Fix:         "Delete DNS records for resources you no longer use and keep internal names out of public DNS.",
		Refs:        refs("1.2", "", "A.8.20", "CC6.6"),
		sources:     []string{"surface"},
		prefixes:    []string{"surface.takeover", "surface.private_dns"},
	},
	{
		ID: "known-vulnerabilities", Area: "Vulnerability management", Title: "No known vulnerabilities in exposed software",
		Description: "Software found on your hosts has no unresolved known vulnerabilities. Ones you marked as false positives are left out; accepted risks count as warnings.",
		Fix:         "Upgrade the affected software, or record a decision on the Vulnerabilities page.",
		Refs:        refs("7.7", "6.3.3", "A.8.8", "CC7.1"),
		custom:      vulnerabilities,
	},
	{
		ID: "scheduled-scanning", Area: "Vulnerability management", Title: "External scans run on a schedule",
		Description: "Every verified domain has a scheduled attack surface scan, so new exposure is found without anyone remembering to look.",
		Fix:         "Turn on scheduled scans for each verified domain on the Attack surface page.",
		Refs:        refs("7.6", "11.3.2", "A.8.8", "CC7.1"),
		custom:      scheduling,
	},
	{
		ID: "exposed-files", Area: "Data protection", Title: "No sensitive files are public",
		Description: "An approved deep scan found no exposed source control folders, environment files, backups, or database dumps.",
		Fix:         "Remove the files from the web root and block the paths at the server, then rotate any secrets they held.",
		Refs:        refs("3.3", "", "A.8.12", "CC6.1"),
		sources:     []string{"deep"},
		prefixes:    []string{"deep."},
	},
	{
		ID: "availability-monitoring", Area: "Operations", Title: "Availability is monitored with alerts",
		Description: "Uptime monitors check your services and tell someone when they go down.",
		Fix:         "Add monitors for your key services and send their alerts to email or a channel.",
		Refs:        refs("", "", "A.8.16", "CC7.2"),
		custom:      monitoring,
	},
}

func severityStatus(s passive.Severity) Status {
	switch s {
	case passive.High:
		return Fail
	case passive.Medium, passive.Low:
		return Warn
	}
	return Pass
}

func worse(a, b Status) Status {
	rank := map[Status]int{NotAssessed: 0, Pass: 1, Warn: 2, Fail: 3}
	if rank[b] > rank[a] {
		return b
	}
	return a
}

func (c Control) matches(id string) bool {
	for _, p := range c.prefixes {
		if strings.HasPrefix(id, p) {
			return true
		}
	}
	return false
}

// fresh are the scans within the window.
func fresh(in Input) []Scan {
	out := []Scan{}
	for _, s := range in.Scans {
		if in.Now.Sub(s.At) <= Window {
			out = append(out, s)
		}
	}
	return out
}

func fromFindings(in Input, c Control) Result {
	r := Result{Control: c, Status: NotAssessed, Evidence: []Finding{}}
	domains := map[string]bool{}
	skipped := map[string]bool{}
	for _, s := range fresh(in) {
		if !slices.Contains(c.sources, s.Kind) {
			continue
		}
		if !applies(c, s) {
			skipped[s.Domain] = true
			continue
		}
		domains[s.Domain] = true
		r.Status = worse(r.Status, Pass)
		for _, f := range s.Findings {
			if !c.matches(f.ID) || f.Severity == passive.Info || f.Severity == passive.Pass {
				continue
			}
			r.Status = worse(r.Status, severityStatus(f.Severity))
			r.Evidence = append(r.Evidence, f)
		}
	}
	r.Domains = sortedKeys(domains)
	switch r.Status {
	case NotAssessed:
		if len(skipped) > 0 && c.needs == "tls" {
			r.Summary = "Can't be checked: HTTPS isn't available on " + plural(len(skipped), "domain") + "."
		} else if len(skipped) > 0 {
			r.Summary = "Doesn't apply: no website on " + plural(len(skipped), "domain") + "."
		} else {
			r.Summary = "No " + strings.Join(kindNames(c.sources), " or ") + " in the last 30 days."
		}
	case Pass:
		r.Summary = "Nothing found on " + plural(len(r.Domains), "domain") + "."
	default:
		r.Summary = plural(len(r.Evidence), "finding") + " on " + plural(len(r.Domains), "domain") + "."
	}
	return r
}

// applies says whether a passive scan can say anything about the control:
// header checks need a website, and certificate checks need HTTPS.
func applies(c Control, s Scan) bool {
	if c.needs == "" || s.Kind != "passive" {
		return true
	}
	for _, f := range s.Findings {
		if f.ID == "web.none" {
			return false
		}
		if c.needs == "tls" && (f.ID == "tls.unavailable" || f.ID == "tls.no_cert") {
			return false
		}
	}
	return true
}

func inventory(in Input, c Control) Result {
	r := Result{Control: c, Status: NotAssessed, Evidence: []Finding{}}
	surfaced := map[string]bool{}
	for _, s := range fresh(in) {
		if s.Kind == "surface" {
			surfaced[s.Domain] = true
		}
	}
	missing := []string{}
	for _, d := range in.Domains {
		if !d.Verified {
			continue
		}
		r.Domains = append(r.Domains, d.Domain)
		if !surfaced[d.Domain] {
			missing = append(missing, d.Domain)
			r.Evidence = append(r.Evidence, Finding{Domain: d.Domain, ID: "inventory.no_surface", Title: "No attack surface scan in the last 30 days", Severity: passive.Medium, At: in.Now})
		}
	}
	switch {
	case len(r.Domains) == 0:
		r.Summary = "No verified domains yet."
	case len(missing) == 0:
		r.Status = Pass
		r.Summary = plural(len(r.Domains), "verified domain") + ", all scanned in the last 30 days."
	default:
		r.Status = Warn
		r.Summary = plural(len(missing), "verified domain") + " without a recent attack surface scan."
	}
	return r
}

func scheduling(in Input, c Control) Result {
	r := Result{Control: c, Status: NotAssessed, Evidence: []Finding{}}
	watched := map[string]bool{}
	for _, w := range in.Watches {
		if w.Enabled && w.Kind == "surface" && w.IntervalHours <= 24*31 {
			watched[w.Domain] = true
		}
	}
	missing := 0
	for _, d := range in.Domains {
		if !d.Verified {
			continue
		}
		r.Domains = append(r.Domains, d.Domain)
		if !watched[d.Domain] {
			missing++
			r.Evidence = append(r.Evidence, Finding{Domain: d.Domain, ID: "schedule.missing", Title: "No scheduled attack surface scan", Severity: passive.Medium, At: in.Now})
		}
	}
	switch {
	case len(r.Domains) == 0:
		r.Summary = "No verified domains yet."
	case missing == 0:
		r.Status = Pass
		r.Summary = "Every verified domain is scanned on a schedule."
	default:
		r.Status = Warn
		r.Summary = plural(missing, "verified domain") + " not scanned on a schedule."
	}
	return r
}

func vulnerabilities(in Input, c Control) Result {
	r := Result{Control: c, Status: NotAssessed, Evidence: []Finding{}}
	domains := map[string]bool{}
	for _, s := range fresh(in) {
		if s.Kind == "surface" {
			domains[s.Domain] = true
			r.Status = Pass
		}
	}
	open := 0
	for _, v := range in.Vulns {
		if !domains[v.Domain] || v.Decision == "false_positive" {
			continue
		}
		st, sev := Warn, passive.Medium
		if v.Decision != "accepted" && (v.KEV || v.Severity == "critical" || v.Severity == "high") {
			st, sev = Fail, passive.High
		}
		if v.Decision != "accepted" {
			open++
		}
		title := v.CVE
		if v.Decision == "accepted" {
			title += " (risk accepted)"
		}
		if v.Summary != "" {
			title += ": " + v.Summary
		}
		r.Status = worse(r.Status, st)
		r.Evidence = append(r.Evidence, Finding{Kind: "surface", Domain: v.Domain, Host: v.Host, ID: v.CVE, Title: title, Severity: sev, ScanID: v.ScanID, At: v.At})
	}
	r.Domains = sortedKeys(domains)
	switch r.Status {
	case NotAssessed:
		r.Summary = "No attack surface scans in the last 30 days."
	case Pass:
		r.Summary = "No known vulnerabilities on " + plural(len(r.Domains), "domain") + "."
	default:
		r.Summary = plural(open, "open vulnerability", "open vulnerabilities") + ", " + plural(len(r.Evidence)-open, "accepted risk") + "."
	}
	return r
}

func monitoring(in Input, c Control) Result {
	r := Result{Control: c, Evidence: []Finding{}, Domains: []string{}}
	switch {
	case in.Monitors == 0:
		r.Status = NotAssessed
		r.Summary = "No uptime monitors yet."
	case !in.Alerting:
		r.Status = Warn
		r.Summary = plural(in.Monitors, "monitor") + ", but none alert anyone."
		r.Evidence = append(r.Evidence, Finding{ID: "monitoring.no_alerts", Title: "Monitors don't notify anyone", Severity: passive.Medium, At: in.Now})
	default:
		r.Status = Pass
		r.Summary = plural(in.Monitors, "monitor") + " with alerts."
	}
	return r
}

// Evaluate checks every control against the input.
func Evaluate(in Input) Report {
	if in.Now.IsZero() {
		in.Now = time.Now()
	}
	rep := Report{Counts: map[Status]int{Pass: 0, Warn: 0, Fail: 0, NotAssessed: 0}, Window: int(Window.Hours() / 24), CheckedAt: in.Now, Sources: []Source{}}
	for _, c := range Controls {
		var r Result
		if c.custom != nil {
			r = c.custom(in, c)
		} else {
			r = fromFindings(in, c)
		}
		if r.Domains == nil {
			r.Domains = []string{}
		}
		sort.SliceStable(r.Evidence, func(i, j int) bool {
			return severityStatus(r.Evidence[i].Severity) == Fail && severityStatus(r.Evidence[j].Severity) != Fail
		})
		rep.Counts[r.Status]++
		rep.Controls = append(rep.Controls, r)
	}
	for _, f := range Frameworks {
		fs := FrameworkScore{Framework: f}
		for _, r := range rep.Controls {
			if len(r.Refs[f.ID]) == 0 {
				continue
			}
			fs.Mapped++
			switch r.Status {
			case Pass:
				fs.Passing++
			case Warn:
				fs.Warning++
			case Fail:
				fs.Failing++
			default:
				fs.NotAssessed++
			}
		}
		fs.Assessed = fs.Mapped - fs.NotAssessed
		if fs.Assessed > 0 {
			fs.Percent = fs.Passing * 100 / fs.Assessed
		}
		rep.Frameworks = append(rep.Frameworks, fs)
	}
	for _, s := range fresh(in) {
		rep.Sources = append(rep.Sources, Source{Kind: s.Kind, Domain: s.Domain, ScanID: s.ScanID, At: s.At})
	}
	sort.Slice(rep.Sources, func(i, j int) bool { return rep.Sources[i].At.After(rep.Sources[j].At) })
	return rep
}

func kindNames(kinds []string) []string {
	names := map[string]string{"passive": "passive checks", "surface": "attack surface scans", "deep": "deep scans"}
	out := make([]string, len(kinds))
	for i, k := range kinds {
		out[i] = names[k]
	}
	return out
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func plural(n int, one string, many ...string) string {
	word := one + "s"
	if len(many) > 0 {
		word = many[0]
	}
	if n == 1 {
		word = one
	}
	return strconv.Itoa(n) + " " + word
}
