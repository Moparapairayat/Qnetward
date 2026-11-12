package compliance

import (
	"testing"
	"time"

	"qnetward/internal/engine/passive"
)

func byID(rep Report) map[string]Result {
	out := map[string]Result{}
	for _, r := range rep.Controls {
		out[r.ID] = r
	}
	return out
}

func TestEvaluate(t *testing.T) {
	now := time.Date(2026, 11, 12, 12, 0, 0, 0, time.UTC)
	f := func(id string, sev passive.Severity) Finding {
		return Finding{Domain: "example.com", ID: id, Title: id, Severity: sev}
	}
	in := Input{
		Now: now,
		Scans: []Scan{
			{Kind: "passive", Domain: "example.com", ScanID: 1, At: now.Add(-time.Hour), Findings: []Finding{
				f("tls.cert.ok", passive.Pass), f("http.csp.missing", passive.Medium), f("email.dmarc.missing", passive.High),
			}},
			{Kind: "surface", Domain: "example.com", ScanID: 2, At: now.Add(-2 * time.Hour), Findings: []Finding{
				f("surface.port.5432", passive.High), f("surface.sensitive_name", passive.Info), f("tls.legacy", passive.Medium),
			}},
			// Too old to count.
			{Kind: "deep", Domain: "example.com", ScanID: 3, At: now.Add(-40 * 24 * time.Hour), Findings: []Finding{f("deep.env", passive.High)}},
		},
		Vulns: []Vuln{
			{Domain: "example.com", Host: "a.example.com", CVE: "CVE-2024-1", Severity: "critical", Decision: "false_positive"},
			{Domain: "example.com", Host: "a.example.com", CVE: "CVE-2024-2", Severity: "high", Decision: "accepted"},
			{Domain: "other.com", Host: "other.com", CVE: "CVE-2024-3", Severity: "critical"},
		},
		Domains:  []Domain{{Domain: "example.com", Verified: true}, {Domain: "pending.com"}},
		Watches:  []Watch{{Kind: "passive", Domain: "example.com", IntervalHours: 24, Enabled: true}},
		Monitors: 2,
	}
	rep := Evaluate(in)
	got := byID(rep)
	want := map[string]Status{
		"transport-encryption":    Pass,
		"tls-protocols":           Warn,
		"certificates":            Pass,
		"browser-protections":     Warn,
		"email-authentication":    Fail,
		"exposed-services":        Fail,
		"dangling-dns":            Pass,
		"exposed-files":           NotAssessed,
		"asset-inventory":         Pass,
		"scheduled-scanning":      Warn,
		"known-vulnerabilities":   Warn,
		"availability-monitoring": Warn,
	}
	for id, st := range want {
		if got[id].Status != st {
			t.Errorf("%s: got %s (%s), want %s", id, got[id].Status, got[id].Summary, st)
		}
	}
	if ev := got["known-vulnerabilities"].Evidence; len(ev) != 1 || ev[0].ID != "CVE-2024-2" {
		t.Fatalf("false positives and other domains' vulns are left out: %+v", ev)
	}
	if ev := got["exposed-services"].Evidence; len(ev) != 1 || ev[0].ID != "surface.port.5432" {
		t.Fatalf("only matching, non-info findings are evidence: %+v", ev)
	}
	if len(rep.Sources) != 2 {
		t.Fatalf("only fresh scans are sources: %+v", rep.Sources)
	}

	var cis FrameworkScore
	for _, fs := range rep.Frameworks {
		if fs.ID == "cis" {
			cis = fs
		}
	}
	if cis.Mapped == 0 || cis.Assessed != cis.Mapped-cis.NotAssessed || cis.Percent != cis.Passing*100/cis.Assessed {
		t.Fatalf("framework score adds up: %+v", cis)
	}

	in.Alerting = true
	if byID(Evaluate(in))["availability-monitoring"].Status != Pass {
		t.Fatal("monitors that alert pass")
	}
	// Without HTTPS, certificate checks can't pass and HTTPS isn't enforced.
	plain := byID(Evaluate(Input{Now: now, Scans: []Scan{{Kind: "passive", Domain: "example.com", At: now, Findings: []Finding{
		f("tls.unavailable", passive.High), f("http.plaintext_only", passive.High),
	}}}}))
	if plain["certificates"].Status != NotAssessed || plain["tls-protocols"].Status != NotAssessed || plain["https-enforced"].Status != Fail || plain["browser-protections"].Status != Pass {
		t.Fatalf("plain HTTP site: certs %s, versions %s, enforced %s, headers %s", plain["certificates"].Status, plain["tls-protocols"].Status, plain["https-enforced"].Status, plain["browser-protections"].Status)
	}
	noWeb := byID(Evaluate(Input{Now: now, Scans: []Scan{{Kind: "passive", Domain: "example.com", At: now, Findings: []Finding{f("web.none", passive.Info)}}}}))
	if noWeb["browser-protections"].Status != NotAssessed || noWeb["email-authentication"].Status != Pass {
		t.Fatal("a mail-only domain has no web controls but still has email ones")
	}
	if r := byID(Evaluate(Input{Now: now})); r["transport-encryption"].Status != NotAssessed || r["asset-inventory"].Status != NotAssessed {
		t.Fatal("nothing scanned means nothing assessed")
	}
}
