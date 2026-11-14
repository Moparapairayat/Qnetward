package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

type apiError struct {
	Error string `json:"error"`
}

func requestIsSecure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https") {
		return true
	}
	if strings.Contains(strings.ToLower(r.Header.Get("Cf-Visitor")), "\"https\"") {
		return true
	}
	return false
}

func requestHost(r *http.Request) string {
	if forwardedHost := strings.TrimSpace(r.Header.Get("X-Forwarded-Host")); forwardedHost != "" {
		return forwardedHost
	}
	return r.Host
}

func requestScheme(r *http.Request) string {
	if requestIsSecure(r) {
		return "https"
	}
	return "http"
}

// carrierNAT is 100.64.0.0/10, shared address space that cloud networks use
// internally; netip treats it as public.
var carrierNAT = netip.MustParsePrefix("100.64.0.0/10")

// internalAddr reports whether a is a loopback, private, link-local, or
// carrier-NAT address: one of our own proxies, never a visitor on the internet.
func internalAddr(a netip.Addr) bool {
	a = a.Unmap()
	return a.IsLoopback() || a.IsPrivate() || a.IsLinkLocalUnicast() || a.IsUnspecified() || carrierNAT.Contains(a)
}

// clientIPFromRequest is the address of whoever made the request, for rate
// limits, sessions, and the audit log, so it must not be something the client
// can choose.
//
// A connection straight from a public address is that address, and headers
// are ignored. Behind our proxies (Render's edge, then nginx) the connection
// comes from an internal address and the client is in X-Forwarded-For. Each
// proxy appends the address it saw, so only the right-hand entries are
// trustworthy; anything to their left was sent by the client and may be made
// up. So walk from the right past our own internal hops and take the first
// public address. Headers such as CF-Connecting-IP are not trusted: nothing
// in front of us sets them, so a client could.
func clientIPFromRequest(r *http.Request) string {
	remote := strings.TrimSpace(r.RemoteAddr)
	if host, _, err := net.SplitHostPort(remote); err == nil && host != "" {
		remote = host
	}
	remoteAddr, err := netip.ParseAddr(remote)
	if err != nil || !internalAddr(remoteAddr) {
		return remote
	}
	var hops []string
	for _, header := range r.Header.Values("X-Forwarded-For") {
		hops = append(hops, strings.Split(header, ",")...)
	}
	nearest := ""
	for i := len(hops) - 1; i >= 0; i-- {
		addr, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			continue
		}
		addr = addr.Unmap()
		if !internalAddr(addr) {
			return addr.String()
		}
		if nearest == "" {
			nearest = addr.String()
		}
	}
	// Every hop was internal, as in local development or on a private network:
	// the nearest one is the client.
	if nearest != "" {
		return nearest
	}
	return remote
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) error {
	if r.Body == nil {
		return fmt.Errorf("empty body")
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
	defer r.Body.Close()

	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		if strings.Contains(err.Error(), "http: request body too large") {
			return fmt.Errorf("request body too large")
		}
		return err
	}
	var extra struct{}
	if err := dec.Decode(&extra); err != io.EOF {
		return fmt.Errorf("request body must contain a single JSON object")
	}
	return nil
}

func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Referrer-Policy", "same-origin")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}
