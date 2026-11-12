package surface

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/miekg/dns"

	"qnetward/internal/engine/passive"
)

func has(fs []Finding, host, id string, sev passive.Severity) bool {
	for _, f := range fs {
		if f.Host == host && f.ID == id && f.Severity == sev {
			return true
		}
	}
	return false
}

func TestRun(t *testing.T) {
	// Certificate logs know two names, one outside the domain.
	ct := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.RawQuery, "example.com") {
			t.Errorf("unexpected CT query %q", r.URL.RawQuery)
		}
		_, _ = w.Write([]byte(`[{"name_value":"*.example.com\napi.example.com"},{"name_value":"shop.example.com"},{"name_value":"evil.example.org"}]`))
	}))
	defer ct.Close()

	records := map[string][]string{
		"example.com/A":          {"203.0.113.10"},
		"api.example.com/A":      {"203.0.113.11"},
		"shop.example.com/CNAME": {"gone-shop.herokuapp.com."},
		"dev.example.com/A":      {"10.0.0.5"},
		"www.example.com/CNAME":  {"example.com."},
		"www.example.com/A":      {"203.0.113.10"},
	}
	nx := map[string]bool{"gone-shop.herokuapp.com": true}
	open := map[string]bool{"203.0.113.10:443": true, "203.0.113.10:80": true, "203.0.113.11:5432": true, "203.0.113.11:80": true}

	cfg := Config{
		CTURL: ct.URL + "/",
		CheckAddr: func(a netip.Addr) error {
			if a.IsPrivate() {
				return errors.New("private")
			}
			return nil
		},
		PortTimeout: 200 * time.Millisecond,
		skipTLS:     true,
		lookup: func(_ context.Context, name string, qtype uint16) ([]string, bool, error) {
			name = strings.TrimSuffix(name, ".")
			if nx[name] {
				return nil, true, nil
			}
			return records[name+"/"+dns.TypeToString[qtype]], false, nil
		},
		dial: func(_ context.Context, _, address string) (net.Conn, error) {
			if open[address] {
				c1, c2 := net.Pipe()
				_ = c2.Close()
				return c1, nil
			}
			return nil, errors.New("refused")
		},
	}
	rep, err := Run(context.Background(), "example.com", cfg)
	if err != nil {
		t.Fatal(err)
	}

	byName := map[string]Host{}
	for _, h := range rep.Hosts {
		byName[h.Name] = h
	}
	if _, ok := byName["evil.example.org"]; ok {
		t.Fatal("names outside the domain must never be scanned")
	}
	for _, name := range []string{"example.com", "api.example.com", "shop.example.com", "dev.example.com", "www.example.com"} {
		if _, ok := byName[name]; !ok {
			t.Errorf("expected host %s; got %+v", name, rep.Hosts)
		}
	}
	if _, ok := byName["mail.example.com"]; ok {
		t.Error("names that don't resolve are dropped")
	}
	if byName["api.example.com"].Source != "certificate logs" || byName["dev.example.com"].Source != "common name" {
		t.Errorf("sources: %+v %+v", byName["api.example.com"], byName["dev.example.com"])
	}
	if dev := byName["dev.example.com"]; !dev.Private || len(dev.OpenPorts) != 0 {
		t.Errorf("a private address is listed but not probed: %+v", dev)
	}
	if got := byName["example.com"].OpenPorts; len(got) != 2 || got[0] != 80 || got[1] != 443 {
		t.Errorf("open ports: %v", got)
	}

	for _, want := range []struct {
		host, id string
		sev      passive.Severity
	}{
		{"shop.example.com", "surface.takeover", passive.High},
		{"api.example.com", "surface.port.5432", passive.High},
		{"api.example.com", "surface.http_only", passive.Medium},
		{"dev.example.com", "surface.private_dns", passive.Low},
		{"dev.example.com", "surface.sensitive_name", passive.Info},
	} {
		if !has(rep.Findings, want.host, want.id, want.sev) {
			t.Errorf("missing %s on %s (%s); findings %+v", want.id, want.host, want.sev, rep.Findings)
		}
	}
	if rep.Findings[0].Severity != passive.High || rep.Grade == "" || rep.Counts[passive.High] != 2 {
		t.Errorf("worst first and graded: %s %+v", rep.Grade, rep.Counts)
	}
}

func TestTakeoverService(t *testing.T) {
	for _, s := range []string{"x.herokuapp.com", "bucket.s3.amazonaws.com", "app.azurewebsites.net", "u.github.io"} {
		if !takeoverService(s) {
			t.Errorf("%s should count as a takeover-prone service", s)
		}
	}
	if takeoverService("example.com") || takeoverService("cdn.example.net") {
		t.Error("ordinary names are not takeover-prone")
	}
}
