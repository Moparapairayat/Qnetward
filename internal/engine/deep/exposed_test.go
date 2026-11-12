package deep

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"qnetward/internal/engine/passive"
)

func serve(t *testing.T, h http.HandlerFunc) Config {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return Config{Gap: time.Millisecond, dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, network, strings.TrimPrefix(srv.URL, "http://"))
	}}
}

func TestExposedFiles(t *testing.T) {
	cfg := serve(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/":
			_, _ = w.Write([]byte("home"))
		case "/.git/HEAD":
			_, _ = w.Write([]byte("ref: refs/heads/main\n"))
		case "/.env":
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write([]byte("APP_ENV=production\nDB_PASSWORD=hunter2\n"))
		case "/uploads/":
			_, _ = w.Write([]byte("<html><title>Index of /uploads</title>"))
		case "/backup.zip":
			// A redirect is not an exposed file.
			http.Redirect(w, r, "/elsewhere.zip", http.StatusFound)
		default:
			http.NotFound(w, r)
		}
	})
	rep, err := Run(context.Background(), "example.com", []string{"example.com"}, Checks, cfg)
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]passive.Severity{}
	for _, f := range rep.Findings {
		ids[f.ID] = f.Severity
		if strings.Contains(f.Detail, "hunter2") {
			t.Fatal("file contents must never be copied into the report")
		}
	}
	if ids["deep.git"] != passive.High || ids["deep.env"] != passive.High || ids["deep.listing"] != passive.Medium {
		t.Fatalf("expected git, env, and listing findings: %+v", rep.Findings)
	}
	if _, ok := ids["deep.backup"]; ok {
		t.Fatal("a redirect must not count as an exposed backup")
	}
	if rep.Findings[0].Severity != passive.High || rep.Requests < len(probes) || rep.Grade == "" {
		t.Fatalf("worst first, every probe requested, graded: %+v", rep)
	}
}

// A site that answers 200 with the same page for every path isn't reported
// for every file.
func TestSoftNotFoundIsNotAHit(t *testing.T) {
	cfg := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html><body>Welcome! ref: refs/heads/main CREATE TABLE DB_PASSWORD= PRIVATE KEY----- Index of /</body></html>"))
	})
	rep, err := Run(context.Background(), "example.com", []string{"example.com"}, Checks, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Findings) != 0 {
		t.Fatalf("a catch-all page must not produce findings: %+v", rep.Findings)
	}
}

func TestHostsOutsideTheApprovalAreSkipped(t *testing.T) {
	cfg := serve(t, func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) })
	cfg.Allowed = func(_ context.Context, host string) error {
		if host == "lapsed.example.com" {
			return errors.New("no longer verified")
		}
		return nil
	}
	rep, err := Run(context.Background(), "example.com", []string{"example.com", "lapsed.example.com"}, Checks, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(rep.Skipped) != 1 || !strings.HasPrefix(rep.Skipped[0], "lapsed.example.com") {
		t.Fatalf("the unverified host is skipped and says why: %+v", rep.Skipped)
	}
}
