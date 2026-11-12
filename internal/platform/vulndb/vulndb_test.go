package vulndb

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestLookup(t *testing.T) {
	var nvdCalls atomic.Int32
	mux := http.NewServeMux()
	mux.HandleFunc("/nvd", func(w http.ResponseWriter, r *http.Request) {
		nvdCalls.Add(1)
		if got := r.URL.Query().Get("virtualMatchString"); got != "cpe:2.3:a:f5:nginx:1.18.0:*:*:*:*:*:*:*" {
			t.Errorf("unexpected CPE %q", got)
		}
		if r.Header.Get("apiKey") != "k" {
			t.Error("the API key goes in the apiKey header")
		}
		_, _ = w.Write([]byte(`{"vulnerabilities":[
			{"cve":{"id":"CVE-2021-23017","published":"2021-06-01T13:15:00.000","descriptions":[{"lang":"en","value":"A resolver bug."}],
				"metrics":{"cvssMetricV31":[{"type":"Primary","cvssData":{"baseScore":7.7}}]}}},
			{"cve":{"id":"CVE-2020-0002","descriptions":[{"lang":"en","value":"Minor."}],"metrics":{"cvssMetricV2":[{"type":"Primary","cvssData":{"baseScore":4.3}}]}}},
			{"cve":{"id":"CVE-2020-0003","vulnStatus":"Rejected","descriptions":[],"metrics":{}}}
		]}`))
	})
	mux.HandleFunc("/kev", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"vulnerabilities":[{"cveID":"CVE-2021-23017"}]}`))
	})
	mux.HandleFunc("/epss", func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Query().Get("cve"), "CVE-2020-0002") {
			t.Errorf("EPSS should be asked for every CVE: %q", r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(`{"data":[{"cve":"CVE-2020-0002","epss":"0.31"}]}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := New("k")
	c.NVDURL, c.KEVURL, c.EPSSURL = srv.URL+"/nvd", srv.URL+"/kev", srv.URL+"/epss"
	vulns, err := c.Lookup(context.Background(), "cpe:2.3:a:f5:nginx:1.18.0:*:*:*:*:*:*:*")
	if err != nil {
		t.Fatal(err)
	}
	if len(vulns) != 2 {
		t.Fatalf("rejected CVEs are left out: %+v", vulns)
	}
	if v := vulns[0]; v.CVE != "CVE-2021-23017" || !v.KEV || v.Severity != "critical" || v.CVSS != 7.7 || v.Published != "2021-06-01" {
		t.Fatalf("an exploited CVE is critical and first: %+v", v)
	}
	if v := vulns[1]; v.Severity != "high" || v.EPSS != 0.31 {
		t.Fatalf("a likely-to-be-exploited CVE is high despite CVSS 4.3: %+v", v)
	}

	if _, err := c.Lookup(context.Background(), "cpe:2.3:a:f5:nginx:1.18.0:*:*:*:*:*:*:*"); err != nil || nvdCalls.Load() != 1 {
		t.Fatalf("a second lookup is answered from the cache, calls %d", nvdCalls.Load())
	}
}
