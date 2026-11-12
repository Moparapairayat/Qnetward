// Package ownership proves that a workspace controls a domain, before any
// check deeper than a passive one may touch it. Proof is a token the
// workspace publishes either as a DNS TXT record or as a file on the site.
package ownership

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"syscall"
	"time"

	"github.com/miekg/dns"
)

const (
	// RecordPrefix is the DNS label the TXT record lives under.
	RecordPrefix = "_qnetward-verify"
	// FilePath is where the HTTP proof is served.
	FilePath = "/.well-known/qnetward-verify.txt"
	// TokenPrefix starts every token, so a TXT value is easy to recognise.
	TokenPrefix = "qnetward-verify="

	MethodDNS  = "dns"
	MethodHTTP = "http"
)

var defaultResolvers = []string{"1.1.1.1:53", "8.8.8.8:53", "9.9.9.9:53"}

// NewToken returns a fresh, unguessable proof token.
func NewToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return TokenPrefix + hex.EncodeToString(b), nil
}

// RecordName is the TXT record name for domain.
func RecordName(domain string) string { return RecordPrefix + "." + domain }

// FileURL is the HTTPS URL of the proof file for domain.
func FileURL(domain string) string { return "https://" + domain + FilePath }

// Config tunes a check.
type Config struct {
	Timeout     time.Duration
	Resolvers   []string
	DialControl func(network, address string, c syscall.RawConn) error

	// Tests point the check at local servers.
	dialContext func(ctx context.Context, network, address string) (net.Conn, error)
	lookupTXT   func(ctx context.Context, name string) ([]string, error)
}

// ErrNotFound means neither proof was found.
var ErrNotFound = errors.New("no proof found")

// Check looks for token in DNS first, then over HTTPS (and plain HTTP). It
// returns the method that proved ownership, or an error describing what it
// saw, wrapping ErrNotFound when nothing matched.
func Check(ctx context.Context, domain, token string, cfg Config) (string, error) {
	if cfg.Timeout <= 0 {
		cfg.Timeout = 8 * time.Second
	}
	if len(cfg.Resolvers) == 0 {
		cfg.Resolvers = defaultResolvers
	}
	lookup := cfg.lookupTXT
	if lookup == nil {
		lookup = func(ctx context.Context, name string) ([]string, error) { return queryTXT(ctx, name, cfg) }
	}

	var notes []string
	values, err := lookup(ctx, RecordName(domain))
	switch {
	case err != nil:
		notes = append(notes, "DNS: "+err.Error())
	case containsToken(values, token):
		return MethodDNS, nil
	case len(values) > 0:
		notes = append(notes, fmt.Sprintf("DNS: %s has a TXT record, but not this workspace's token", RecordName(domain)))
	default:
		notes = append(notes, "DNS: no TXT record at "+RecordName(domain))
	}

	for _, scheme := range []string{"https", "http"} {
		body, err := fetch(ctx, scheme+"://"+domain+FilePath, domain, cfg)
		if err != nil {
			notes = append(notes, strings.ToUpper(scheme)+": "+err.Error())
			continue
		}
		if containsToken(strings.Fields(body), token) {
			return MethodHTTP, nil
		}
		notes = append(notes, strings.ToUpper(scheme)+": the file is there, but doesn't hold this workspace's token")
		break
	}
	return "", fmt.Errorf("%w (%s)", ErrNotFound, strings.Join(notes, "; "))
}

func containsToken(values []string, token string) bool {
	for _, v := range values {
		if strings.TrimSpace(strings.Trim(v, `"`)) == token {
			return true
		}
	}
	return false
}

func queryTXT(ctx context.Context, name string, cfg Config) ([]string, error) {
	msg := new(dns.Msg)
	msg.SetQuestion(dns.Fqdn(name), dns.TypeTXT)
	msg.SetEdns0(4096, false)
	var lastErr error
	for _, server := range cfg.Resolvers {
		resp, _, err := (&dns.Client{Timeout: cfg.Timeout}).ExchangeContext(ctx, msg, server)
		if err == nil && resp.Truncated {
			resp, _, err = (&dns.Client{Net: "tcp", Timeout: cfg.Timeout}).ExchangeContext(ctx, msg, server)
		}
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			lastErr = err
			continue
		}
		if resp.Rcode == dns.RcodeNameError {
			return nil, nil
		}
		if resp.Rcode != dns.RcodeSuccess {
			lastErr = fmt.Errorf("the resolver answered %s", dns.RcodeToString[resp.Rcode])
			continue
		}
		var out []string
		for _, rr := range resp.Answer {
			if t, ok := rr.(*dns.TXT); ok {
				out = append(out, strings.Join(t.Txt, ""))
			}
		}
		return out, nil
	}
	if lastErr == nil {
		lastErr = errors.New("no resolver answered")
	}
	return nil, lastErr
}

// fetch reads a small proof file. Redirects may change scheme or path but
// must stay on the same host, so a redirect can't borrow another site's file.
func fetch(ctx context.Context, url, host string, cfg Config) (string, error) {
	dial := cfg.dialContext
	if dial == nil {
		d := &net.Dialer{Timeout: cfg.Timeout, Control: cfg.DialControl}
		dial = d.DialContext
	}
	client := &http.Client{
		Timeout: cfg.Timeout,
		Transport: &http.Transport{
			Proxy:                 nil,
			DialContext:           dial,
			TLSClientConfig:       &tls.Config{MinVersion: tls.VersionTLS12},
			TLSHandshakeTimeout:   cfg.Timeout,
			ResponseHeaderTimeout: cfg.Timeout,
			DisableKeepAlives:     true,
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("too many redirects")
			}
			if !strings.EqualFold(req.URL.Hostname(), host) {
				return fmt.Errorf("redirected to another host, %s", req.URL.Hostname())
			}
			return nil
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Qnetward-DomainVerify/1.0 (+https://qnetward.com)")
	resp, err := client.Do(req)
	if err != nil {
		var urlErr interface{ Unwrap() error }
		if errors.As(err, &urlErr) && urlErr.Unwrap() != nil {
			err = urlErr.Unwrap()
		}
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%s answered %d", FilePath, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return "", err
	}
	return string(body), nil
}
