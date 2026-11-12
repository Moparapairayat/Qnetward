package surface

import (
	"context"
	"testing"

	"qnetward/internal/engine/passive"
	"qnetward/internal/platform/vulndb"
)

func TestIdentify(t *testing.T) {
	cases := []struct{ banner, product, version, cpe string }{
		{"nginx/1.18.0 (Ubuntu)", "nginx", "1.18.0", "cpe:2.3:a:f5:nginx:1.18.0:*:*:*:*:*:*:*"},
		{"Apache/2.4.49 (Unix) PHP/7.4.3", "Apache httpd", "2.4.49", "cpe:2.3:a:apache:http_server:2.4.49:*:*:*:*:*:*:*"},
		{"SSH-2.0-OpenSSH_8.2p1 Ubuntu-4ubuntu0.5", "OpenSSH", "8.2p1", "cpe:2.3:a:openbsd:openssh:8.2:p1:*:*:*:*:*:*"},
		{"220 (vsFTPd 3.0.3)", "vsftpd", "3.0.3", "cpe:2.3:a:beasts:vsftpd:3.0.3:*:*:*:*:*:*:*"},
		{"MySQL 8.0.32", "MySQL", "8.0.32", "cpe:2.3:a:oracle:mysql:8.0.32:*:*:*:*:*:*:*"},
		{"Microsoft-IIS/10.0", "Microsoft IIS", "10.0", "cpe:2.3:a:microsoft:internet_information_services:10.0:*:*:*:*:*:*:*"},
	}
	for _, c := range cases {
		p, v, cpe := identify(0, c.banner)
		if p != c.product || v != c.version || cpe != c.cpe {
			t.Errorf("identify(%q) = %q %q %q; want %q %q %q", c.banner, p, v, cpe, c.product, c.version, c.cpe)
		}
	}
	for _, b := range []string{"cloudflare", "nginx", "Apache", "SSH-2.0-dropbear"} {
		if p, _, _ := identify(0, b); p != "" {
			t.Errorf("%q has no version and must not be matched, got %q", b, p)
		}
	}
}

type fakeVulns map[string][]vulndb.Vuln

func (f fakeVulns) Lookup(_ context.Context, cpe string) ([]vulndb.Vuln, error) { return f[cpe], nil }

func TestLookupVulns(t *testing.T) {
	const cpe = "cpe:2.3:a:f5:nginx:1.18.0:*:*:*:*:*:*:*"
	rep := Report{Hosts: []Host{
		{Name: "a.example.com", Services: []Service{{Port: 443, Banner: "nginx/1.18.0", Product: "nginx", Version: "1.18.0", CPE: cpe}}},
		{Name: "b.example.com", Services: []Service{{Port: 80, Banner: "nginx/1.18.0", Product: "nginx", Version: "1.18.0", CPE: cpe}}},
		{Name: "c.example.com", Services: []Service{{Port: 80, Banner: "cloudflare"}}},
	}}
	cfg := Config{Vulns: fakeVulns{cpe: {
		{CVE: "CVE-2021-23017", CVSS: 7.7, KEV: true, Severity: "critical"},
		{CVE: "CVE-2019-0001", CVSS: 5.3, Severity: "medium"},
	}}}
	findings := lookupVulns(context.Background(), cfg, &rep)
	if len(rep.Vulns) != 4 {
		t.Fatalf("each host gets the product's vulnerabilities: %+v", rep.Vulns)
	}
	if len(findings) != 2 || findings[0].Severity != passive.High || findings[0].Title != "nginx 1.18.0 has 2 known vulnerabilities, 1 exploited in the wild" {
		t.Fatalf("one finding per host and product: %+v", findings)
	}
	none := Report{Hosts: rep.Hosts}
	if fs := lookupVulns(context.Background(), Config{}, &none); fs != nil || none.Vulns == nil {
		t.Fatal("without a lookup there are no vulnerabilities, and the list is empty, not missing")
	}
}
