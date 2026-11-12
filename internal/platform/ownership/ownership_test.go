package ownership

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNewToken(t *testing.T) {
	a, err := NewToken()
	if err != nil {
		t.Fatal(err)
	}
	b, _ := NewToken()
	if !strings.HasPrefix(a, TokenPrefix) || len(a) != len(TokenPrefix)+32 || a == b {
		t.Fatalf("tokens must be prefixed, 128-bit, and unique: %q %q", a, b)
	}
}

func TestCheck(t *testing.T) {
	const token = TokenPrefix + "0123456789abcdef0123456789abcdef"
	files := map[string]string{}
	site := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch body, ok := files[r.URL.Path]; {
		case r.URL.Path == "/elsewhere":
			http.Redirect(w, r, "http://evil.example/"+FilePath, http.StatusFound)
		case ok:
			_, _ = w.Write([]byte(body))
		default:
			http.NotFound(w, r)
		}
	}))
	defer site.Close()

	txt := map[string][]string{}
	cfg := Config{
		Timeout: 2 * time.Second,
		dialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			var d net.Dialer
			return d.DialContext(ctx, network, strings.TrimPrefix(site.URL, "http://"))
		},
		lookupTXT: func(_ context.Context, name string) ([]string, error) { return txt[name], nil },
	}
	ctx := context.Background()

	if _, err := Check(ctx, "example.com", token, cfg); !errors.Is(err, ErrNotFound) {
		t.Fatalf("no proof anywhere: got %v", err)
	}

	// Someone else's token doesn't count.
	txt[RecordName("example.com")] = []string{TokenPrefix + "ffffffffffffffffffffffffffffffff"}
	if _, err := Check(ctx, "example.com", token, cfg); !errors.Is(err, ErrNotFound) || !strings.Contains(err.Error(), "not this workspace's token") {
		t.Fatalf("a different token must not verify: %v", err)
	}

	txt[RecordName("example.com")] = []string{"v=other", `"` + token + `"`}
	if method, err := Check(ctx, "example.com", token, cfg); err != nil || method != MethodDNS {
		t.Fatalf("TXT proof: %q %v", method, err)
	}

	delete(txt, RecordName("example.com"))
	files[FilePath] = token + "\n"
	if method, err := Check(ctx, "example.com", token, cfg); err != nil || method != MethodHTTP {
		t.Fatalf("file proof: %q %v", method, err)
	}
}
