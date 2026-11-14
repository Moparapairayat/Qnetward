package api

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

// The client address must not be something the client can choose: behind our
// proxies only the right-hand X-Forwarded-For entries are trusted.
func TestClientIPFromRequest(t *testing.T) {
	cases := []struct {
		name, remote string
		forwarded    []string
		cf           string
		want         string
	}{
		{name: "direct connection ignores headers", remote: "203.0.113.7:5555", forwarded: []string{"1.2.3.4"}, cf: "5.6.7.8", want: "203.0.113.7"},
		{name: "behind nginx and Render", remote: "127.0.0.1:40000", forwarded: []string{"198.51.100.20, 10.10.0.5"}, want: "198.51.100.20"},
		{name: "a made-up entry on the left is skipped", remote: "127.0.0.1:40000", forwarded: []string{"1.2.3.4, 198.51.100.20, 10.10.0.5"}, want: "198.51.100.20"},
		{name: "CF-Connecting-IP is not trusted", remote: "127.0.0.1:40000", forwarded: []string{"198.51.100.20"}, cf: "1.2.3.4", want: "198.51.100.20"},
		{name: "several headers read in order", remote: "127.0.0.1:40000", forwarded: []string{"1.2.3.4", "198.51.100.20, 100.64.3.9"}, want: "198.51.100.20"},
		{name: "garbage entries are skipped", remote: "127.0.0.1:40000", forwarded: []string{"unknown, 198.51.100.20, nonsense"}, want: "198.51.100.20"},
		{name: "IPv6 client", remote: "[::1]:40000", forwarded: []string{"2001:db8::1, fd00::2"}, want: "2001:db8::1"},
		{name: "IPv4-mapped IPv6", remote: "127.0.0.1:40000", forwarded: []string{"::ffff:198.51.100.20"}, want: "198.51.100.20"},
		{name: "private network: the nearest hop", remote: "127.0.0.1:40000", forwarded: []string{"10.0.0.9, 192.168.1.5"}, want: "192.168.1.5"},
		{name: "local development without headers", remote: "127.0.0.1:40000", want: "127.0.0.1"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.RemoteAddr = c.remote
			for _, f := range c.forwarded {
				r.Header.Add("X-Forwarded-For", f)
			}
			if c.cf != "" {
				r.Header.Set("CF-Connecting-IP", c.cf)
			}
			if got := clientIPFromRequest(r); got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

// Wrong passwords from many addresses at one account stop at the account's
// own limit, however the per-address limit is dodged.
func TestLoginFailuresLimitedPerAccount(t *testing.T) {
	st := installTestStore(t)
	user, _ := issueTestSession(t, st)
	login := func(ip, password string) int {
		body := `{"email":"` + user.Email + `","password":"` + password + `"}`
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = "127.0.0.1:40000"
		req.Header.Set("X-Forwarded-For", ip+", 10.0.0.1")
		rr := httptest.NewRecorder()
		testSrv.handleAuthLogin(rr, req)
		return rr.Code
	}
	for i := 0; i < loginFailureLimit; i++ {
		// A new address every time, as an attacker rotating addresses would.
		if code := login("198.51.100."+strconv.Itoa(i+1), "wrong-password"); code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: expected 401, got %d", i+1, code)
		}
	}
	if code := login("198.51.100.250", "wrong-password"); code != http.StatusTooManyRequests {
		t.Fatalf("after %d failures from different addresses, expected 429, got %d", loginFailureLimit, code)
	}
}
