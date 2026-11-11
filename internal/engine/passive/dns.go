package passive

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/miekg/dns"
	"golang.org/x/net/publicsuffix"
)

const (
	typeA    = dns.TypeA
	typeAAAA = dns.TypeAAAA
	typeMX   = dns.TypeMX
	typeTXT  = dns.TypeTXT
	typeCAA  = dns.TypeCAA
	typeDS   = dns.TypeDS
)

// errNoRecords means the name exists but has none of the asked type, or
// doesn't exist at all; both mean "not set" to these checks.
var errNoRecords = errors.New("no records")

type resolver struct {
	cfg    Config
	lookup func(ctx context.Context, name string, qtype uint16) ([]string, error)
}

func newResolver(cfg Config) *resolver {
	r := &resolver{cfg: cfg}
	r.lookup = cfg.lookup
	if r.lookup == nil {
		r.lookup = r.query
	}
	return r
}

// query asks the configured resolvers and returns each answer of qtype as
// text: an address, "pref host" for MX, the joined strings for TXT, and
// "flag tag value" for CAA.
func (r *resolver) query(ctx context.Context, name string, qtype uint16) ([]string, error) {
	client := &dns.Client{Timeout: r.cfg.Timeout}
	msg := new(dns.Msg)
	msg.SetQuestion(dns.Fqdn(name), qtype)
	msg.SetEdns0(4096, false)
	var lastErr error
	for _, server := range r.cfg.Resolvers {
		resp, _, err := client.ExchangeContext(ctx, msg, server)
		// Big TXT sets don't fit in UDP; ask again over TCP.
		if err == nil && resp.Truncated {
			tcp := &dns.Client{Net: "tcp", Timeout: r.cfg.Timeout}
			resp, _, err = tcp.ExchangeContext(ctx, msg, server)
		}
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			lastErr = err
			continue
		}
		switch resp.Rcode {
		case dns.RcodeSuccess:
		case dns.RcodeNameError:
			return nil, errNoRecords
		default:
			lastErr = fmt.Errorf("the resolver answered %s", dns.RcodeToString[resp.Rcode])
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
			case *dns.MX:
				// A "null MX" (RFC 7505) says the domain takes no mail.
				if host := strings.TrimSuffix(v.Mx, "."); host != "" {
					out = append(out, fmt.Sprintf("%d %s", v.Preference, host))
				}
			case *dns.TXT:
				out = append(out, strings.Join(v.Txt, ""))
			case *dns.CAA:
				out = append(out, fmt.Sprintf("%d %s %q", v.Flag, v.Tag, v.Value))
			case *dns.DS:
				out = append(out, fmt.Sprintf("%d %d %d", v.KeyTag, v.Algorithm, v.DigestType))
			}
		}
		if len(out) == 0 {
			return nil, errNoRecords
		}
		return out, nil
	}
	if lastErr == nil {
		lastErr = errors.New("no resolver answered")
	}
	return nil, lastErr
}

func (r *resolver) addresses(ctx context.Context, name string) ([]string, error) {
	v4, err4 := r.lookup(ctx, name, typeA)
	v6, err6 := r.lookup(ctx, name, typeAAAA)
	out := append(v4, v6...)
	if len(out) > 0 {
		return out, nil
	}
	if err4 != nil && !errors.Is(err4, errNoRecords) {
		return nil, err4
	}
	if err6 != nil && !errors.Is(err6, errNoRecords) {
		return nil, err6
	}
	return nil, nil
}

// txtLike looks a name up and treats "no records" as an empty answer.
func (r *resolver) txtLike(ctx context.Context, name string, qtype uint16) ([]string, error) {
	out, err := r.lookup(ctx, name, qtype)
	if errors.Is(err, errNoRecords) {
		return nil, nil
	}
	return out, err
}

func checkDNS(ctx context.Context, r *resolver, domain string, info *DNSInfo) []Finding {
	org, err := publicsuffix.EffectiveTLDPlusOne(domain)
	if err != nil {
		org = domain
	}
	info.OrgDomain = org
	noteErr := func(what string, err error) {
		if err != nil {
			info.LookupErrs = append(info.LookupErrs, what+": "+err.Error())
		}
	}

	txt, err := r.txtLike(ctx, domain, typeTXT)
	noteErr("TXT", err)
	for _, t := range txt {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(t)), "v=spf1") {
			info.SPF = append(info.SPF, t)
		}
	}

	// DMARC on the name itself, else the organisational domain's policy.
	for _, name := range uniq(domain, org) {
		recs, err := r.txtLike(ctx, "_dmarc."+name, typeTXT)
		noteErr("DMARC", err)
		for _, t := range recs {
			if strings.HasPrefix(strings.ToLower(strings.TrimSpace(t)), "v=dmarc1") {
				info.DMARC, info.DMARCFrom = t, name
				break
			}
		}
		if info.DMARC != "" {
			break
		}
	}

	// CAA applies from the closest name that has it, up to the org domain.
	for _, name := range climb(domain, org) {
		recs, err := r.txtLike(ctx, name, typeCAA)
		noteErr("CAA", err)
		if len(recs) > 0 {
			info.CAA, info.CAAFrom = recs, name
			break
		}
	}

	ds, err := r.txtLike(ctx, org, typeDS)
	noteErr("DS", err)
	info.DNSSEC = len(ds) > 0
	if info.MX == nil {
		info.MX = []string{}
	}
	if info.SPF == nil {
		info.SPF = []string{}
	}
	if info.CAA == nil {
		info.CAA = []string{}
	}

	findings := analyzeEmail(info.SPF, info.DMARC, len(info.MX) > 0)
	findings = append(findings, analyzeDNS(info)...)
	return findings
}

func uniq(names ...string) []string {
	var out []string
	for _, n := range names {
		if n != "" && !slices.Contains(out, n) {
			out = append(out, n)
		}
	}
	return out
}

// climb lists name and its parents down to org, closest first.
func climb(name, org string) []string {
	out := []string{name}
	for name != org && strings.Contains(name, ".") {
		name = name[strings.Index(name, ".")+1:]
		out = append(out, name)
		if !strings.HasSuffix(name, org) {
			break
		}
	}
	return uniq(out...)
}

// analyzeEmail grades SPF and DMARC. Without them anyone can send mail that
// claims to come from the domain. A domain that sends no mail should still
// say so, or it is the easiest one to spoof.
func analyzeEmail(spf []string, dmarc string, hasMX bool) []Finding {
	var out []Finding
	missing := Medium
	if hasMX {
		missing = High
	}
	switch {
	case len(spf) == 0:
		fix := `Add a TXT record listing who sends your mail, ending in "-all", like "v=spf1 include:_spf.google.com -all".`
		if !hasMX {
			fix = `This domain receives no mail. Publish "v=spf1 -all" so no server can send as it.`
		}
		out = append(out, Finding{ID: "email.spf.missing", Category: CategoryEmail, Severity: missing,
			Title: "No SPF record", Detail: "Mail servers can't tell which servers may send email for this domain, so forged mail is harder to reject.", Fix: fix})
	case len(spf) > 1:
		out = append(out, Finding{ID: "email.spf.multiple", Category: CategoryEmail, Severity: Medium,
			Title: "More than one SPF record", Detail: "With two SPF records, receivers treat SPF as broken and ignore it.",
			Fix: "Merge them into a single TXT record that starts with v=spf1."})
	default:
		rec := strings.ToLower(spf[0])
		switch {
		case strings.Contains(rec, "+all") || strings.HasSuffix(strings.TrimSpace(rec), " all"):
			out = append(out, Finding{ID: "email.spf.allow_all", Category: CategoryEmail, Severity: High,
				Title: "SPF lets any server send as this domain", Detail: `The record ends in "+all", which approves every sender.`,
				Fix: `End the record with "-all" (or "~all" while you test).`})
		case strings.Contains(rec, "?all"):
			out = append(out, Finding{ID: "email.spf.neutral", Category: CategoryEmail, Severity: Medium,
				Title: "SPF is neutral about other senders", Detail: `"?all" tells receivers nothing about mail from servers you didn't list.`,
				Fix: `End the record with "-all" (or "~all" while you test).`})
		case !strings.Contains(rec, "all") && !strings.Contains(rec, "redirect="):
			out = append(out, Finding{ID: "email.spf.no_all", Category: CategoryEmail, Severity: Low,
				Title: "SPF has no catch-all rule", Detail: `Without "-all" or "~all", mail from unlisted servers isn't flagged.`,
				Fix: `Add "-all" at the end of the record.`})
		case strings.Contains(rec, "~all"):
			out = append(out, Finding{ID: "email.spf.softfail", Category: CategoryEmail, Severity: Info,
				Title: "SPF soft-fails other senders", Detail: `"~all" marks unlisted senders as suspicious. Once DMARC is enforcing, "-all" is stricter.`})
		default:
			out = append(out, Finding{ID: "email.spf.ok", Category: CategoryEmail, Severity: Pass, Title: "SPF rejects mail from other servers"})
		}
		if n := strings.Count(rec, "include:") + strings.Count(rec, "redirect=") + strings.Count(rec, " a ") + strings.Count(rec, " mx") + strings.Count(rec, "exists:"); n > 10 {
			out = append(out, Finding{ID: "email.spf.lookups", Category: CategoryEmail, Severity: Medium,
				Title: "SPF needs too many DNS lookups", Detail: fmt.Sprintf("The record has about %d lookups; SPF allows 10, after which it fails.", n),
				Fix: "Flatten includes or drop senders you no longer use."})
		}
	}

	if dmarc == "" {
		fix := `Add a TXT record at _dmarc with "v=DMARC1; p=none; rua=mailto:you@yourdomain", then move to p=quarantine or p=reject once reports look clean.`
		if !hasMX {
			fix = `This domain sends no mail. Publish "v=DMARC1; p=reject" at _dmarc so forged mail is refused.`
		}
		out = append(out, Finding{ID: "email.dmarc.missing", Category: CategoryEmail, Severity: missing,
			Title: "No DMARC policy", Detail: "Receivers have no instruction for mail that fails SPF and DKIM, so spoofed mail can land in inboxes.", Fix: fix})
		return out
	}
	tags := parseTags(dmarc)
	switch strings.ToLower(tags["p"]) {
	case "reject":
		out = append(out, Finding{ID: "email.dmarc.ok", Category: CategoryEmail, Severity: Pass, Title: "DMARC rejects forged mail"})
	case "quarantine":
		out = append(out, Finding{ID: "email.dmarc.ok", Category: CategoryEmail, Severity: Pass, Title: "DMARC sends forged mail to spam"})
	case "none":
		out = append(out, Finding{ID: "email.dmarc.monitor_only", Category: CategoryEmail, Severity: Medium,
			Title: "DMARC only monitors", Detail: "p=none collects reports but lets forged mail through.",
			Fix: "Once reports show your real mail passes, change the policy to p=quarantine, then p=reject."})
	default:
		out = append(out, Finding{ID: "email.dmarc.invalid", Category: CategoryEmail, Severity: Medium,
			Title: "DMARC record has no valid policy", Detail: "Receivers ignore a DMARC record without p=none, quarantine, or reject.",
			Fix: `Start the record with "v=DMARC1; p=quarantine;".`})
	}
	if pct := strings.TrimSpace(tags["pct"]); pct != "" && pct != "100" {
		out = append(out, Finding{ID: "email.dmarc.partial", Category: CategoryEmail, Severity: Low,
			Title: "DMARC applies to only part of the mail", Detail: fmt.Sprintf("pct=%s means the rest of the failing mail is let through.", pct),
			Fix: "Remove pct, or set pct=100."})
	}
	if tags["rua"] == "" {
		out = append(out, Finding{ID: "email.dmarc.no_reports", Category: CategoryEmail, Severity: Info,
			Title: "DMARC sends no reports", Detail: "Without rua= you won't see who sends mail as your domain.",
			Fix: "Add rua=mailto: with an address that collects aggregate reports."})
	}
	return out
}

func parseTags(record string) map[string]string {
	out := map[string]string{}
	for _, part := range strings.Split(record, ";") {
		k, v, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok {
			out[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(v)
		}
	}
	return out
}

func analyzeDNS(info *DNSInfo) []Finding {
	var out []Finding
	if len(info.CAA) == 0 {
		out = append(out, Finding{ID: "dns.caa.missing", Category: CategoryDNS, Severity: Low,
			Title: "No CAA record", Detail: "Any certificate authority may issue certificates for this domain.",
			Fix: `Add a CAA record naming the CAs you use, like 0 issue "letsencrypt.org".`})
	} else {
		out = append(out, Finding{ID: "dns.caa.ok", Category: CategoryDNS, Severity: Pass, Title: "CAA limits who can issue certificates"})
	}
	if info.DNSSEC {
		out = append(out, Finding{ID: "dns.dnssec.ok", Category: CategoryDNS, Severity: Pass, Title: "DNSSEC is on"})
	} else {
		out = append(out, Finding{ID: "dns.dnssec.missing", Category: CategoryDNS, Severity: Info,
			Title: "DNSSEC is off", Detail: "DNS answers for " + info.OrgDomain + " aren't signed, so a resolver can't tell a forged answer from a real one.",
			Fix: "Turn on DNSSEC at your DNS provider and add the DS record at your registrar."})
	}
	return out
}
