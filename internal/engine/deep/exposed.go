// Package deep holds Tier 2 checks: ones that request things an ordinary
// visitor wouldn't. They run only with the domain owner's signed consent and
// a Qnetward admin's approval, inside the approved window and scope.
package deep

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"slices"
	"strings"
	"syscall"
	"time"

	"qnetward/internal/engine/passive"
)

// CheckExposedFiles is the one deep check so far.
const CheckExposedFiles = "exposed_files"

// Checks are the deep checks a request can ask for.
var Checks = []string{CheckExposedFiles}

// probe is a path that should never be public, and how to tell a real hit
// from a site that answers everything with a page.
type probe struct {
	path     string
	id       string
	title    string
	severity passive.Severity
	why      string
	match    func(body []byte, contentType string) bool
}

func contains(subs ...string) func([]byte, string) bool {
	return func(b []byte, _ string) bool {
		for _, s := range subs {
			if bytes.Contains(b, []byte(s)) {
				return true
			}
		}
		return false
	}
}

func prefix(p string) func([]byte, string) bool {
	return func(b []byte, _ string) bool { return bytes.HasPrefix(b, []byte(p)) }
}

var envKey = []byte("=")

// probes are checked on every host in scope. Each needs content that
// proves the file is what its name says, so soft 404s don't count.
var probes = []probe{
	{"/.git/HEAD", "deep.git", "Git repository is public", passive.High,
		"The site's source code and its full history, including any secrets ever committed, can be downloaded.",
		prefix("ref: refs/")},
	{"/.git/config", "deep.git_config", "Git configuration is public", passive.High,
		"It shows the repository's remotes and sometimes credentials.",
		contains("[core]", "repositoryformatversion")},
	{"/.env", "deep.env", "Environment file is public", passive.High,
		"Files like .env usually hold database passwords and API keys.",
		func(b []byte, ct string) bool {
			if strings.Contains(ct, "html") || !bytes.Contains(b, envKey) {
				return false
			}
			for _, k := range []string{"DB_PASSWORD", "DATABASE_URL", "SECRET", "API_KEY", "APP_KEY", "AWS_", "PASSWORD", "TOKEN"} {
				if bytes.Contains(b, []byte(k)) {
					return true
				}
			}
			return false
		}},
	{"/.env.production", "deep.env", "Environment file is public", passive.High,
		"Files like .env usually hold database passwords and API keys.",
		func(b []byte, ct string) bool {
			return !strings.Contains(ct, "html") && contains("PASSWORD", "SECRET", "API_KEY")(b, ct)
		}},
	{"/.aws/credentials", "deep.aws", "AWS credentials are public", passive.High,
		"Anyone can use these keys to act on your AWS account.",
		contains("aws_access_key_id")},
	{"/id_rsa", "deep.private_key", "A private key is public", passive.High,
		"A private SSH key lets anyone log in where it's trusted.",
		contains("PRIVATE KEY-----")},
	{"/.htpasswd", "deep.htpasswd", "Password file is public", passive.High,
		"It holds usernames and password hashes that can be cracked offline.",
		func(b []byte, ct string) bool {
			return !strings.Contains(ct, "html") && (bytes.Contains(b, []byte(":$apr1$")) || bytes.Contains(b, []byte(":$2y$")) || bytes.Contains(b, []byte(":{SHA}")))
		}},
	{"/backup.zip", "deep.backup", "Backup archive is public", passive.High,
		"Backups often contain the whole site, its configuration, and its data.", prefix("PK\x03\x04")},
	{"/backup.tar.gz", "deep.backup", "Backup archive is public", passive.High,
		"Backups often contain the whole site, its configuration, and its data.", prefix("\x1f\x8b")},
	{"/site.zip", "deep.backup", "Backup archive is public", passive.High,
		"Backups often contain the whole site, its configuration, and its data.", prefix("PK\x03\x04")},
	{"/db.sql", "deep.dump", "Database dump is public", passive.High,
		"It holds your data, often including users and password hashes.",
		contains("CREATE TABLE", "INSERT INTO")},
	{"/dump.sql", "deep.dump", "Database dump is public", passive.High,
		"It holds your data, often including users and password hashes.",
		contains("CREATE TABLE", "INSERT INTO")},
	{"/wp-config.php.bak", "deep.wp_config", "WordPress configuration backup is public", passive.High,
		"It holds the database password in plain text.", contains("DB_PASSWORD")},
	{"/.svn/entries", "deep.svn", "Subversion metadata is public", passive.Medium,
		"Source code and history can be reconstructed from it.",
		func(b []byte, ct string) bool {
			return !strings.Contains(ct, "html") && (bytes.HasPrefix(b, []byte("12")) || bytes.HasPrefix(b, []byte("10")))
		}},
	{"/.DS_Store", "deep.ds_store", "macOS folder index is public", passive.Low,
		"It lists file names in the folder, including ones not linked anywhere.", prefix("\x00\x00\x00\x01Bud1")},
	{"/server-status", "deep.server_status", "Apache server status is public", passive.Medium,
		"It shows who is visiting what, live, including internal addresses.", contains("Apache Server Status")},
	{"/phpinfo.php", "deep.phpinfo", "phpinfo() page is public", passive.Medium,
		"It reveals the PHP setup, paths, and environment variables.", contains("phpinfo()", "PHP Version </td>", "PHP Credits")},
	{"/actuator/env", "deep.actuator", "Spring Boot actuator is public", passive.High,
		"Actuator endpoints expose configuration and sometimes secrets.", contains(`"propertySources"`, `"activeProfiles"`)},
	{"/backup/", "deep.listing", "Directory listing is on", passive.Medium,
		"Anyone can browse the files in this folder.", contains("<title>Index of /", "<h1>Index of /")},
	{"/uploads/", "deep.listing", "Directory listing is on", passive.Medium,
		"Anyone can browse the files in this folder.", contains("<title>Index of /", "<h1>Index of /")},
}

// Finding is a passive.Finding about one host.
type Finding struct {
	passive.Finding
	Host string `json:"host"`
	URL  string `json:"url"`
}

// Report is the result of a deep scan.
type Report struct {
	Domain     string                   `json:"domain"`
	Hosts      []string                 `json:"hosts"`
	Checks     []string                 `json:"checks"`
	Grade      string                   `json:"grade"`
	Score      int                      `json:"score"`
	Counts     map[passive.Severity]int `json:"counts"`
	Findings   []Finding                `json:"findings"`
	Requests   int                      `json:"requests"`
	Skipped    []string                 `json:"skipped,omitempty"`
	CheckedAt  time.Time                `json:"checked_at"`
	DurationMs float64                  `json:"duration_ms"`
}

// Config tunes a deep scan.
type Config struct {
	DialControl func(network, address string, c syscall.RawConn) error
	// Allowed is checked for every host right before it's touched, so a
	// domain that loses its verification mid-scan stops being scanned.
	Allowed func(ctx context.Context, host string) error
	// Gap paces requests to one host; 300 ms when zero.
	Gap time.Duration

	dial func(ctx context.Context, network, address string) (net.Conn, error)
}

// Run runs the checks on each host in scope, one request at a time.
func Run(ctx context.Context, domain string, hosts, checks []string, cfg Config) (Report, error) {
	if cfg.Gap <= 0 {
		cfg.Gap = 300 * time.Millisecond
	}
	start := time.Now()
	rep := Report{Domain: domain, Hosts: hosts, Checks: checks, CheckedAt: start.UTC(), Findings: []Finding{}}
	client := newClient(cfg)
	defer client.CloseIdleConnections()

	var findings []Finding
	for _, host := range hosts {
		if cfg.Allowed != nil {
			if err := cfg.Allowed(ctx, host); err != nil {
				rep.Skipped = append(rep.Skipped, host+": "+err.Error())
				continue
			}
		}
		fs, n, err := exposedFiles(ctx, client, host, cfg.Gap)
		rep.Requests += n
		if err != nil {
			if ctx.Err() != nil {
				return Report{}, errors.New("the scan ran out of time")
			}
			rep.Skipped = append(rep.Skipped, host+": "+err.Error())
			continue
		}
		findings = append(findings, fs...)
	}
	plain := make([]passive.Finding, len(findings))
	for i, f := range findings {
		plain[i] = f.Finding
	}
	rep.Score, rep.Grade, rep.Counts = passive.Grade(plain)
	order := map[passive.Severity]int{passive.High: 0, passive.Medium: 1, passive.Low: 2, passive.Info: 3}
	slices.SortStableFunc(findings, func(a, b Finding) int { return order[a.Severity] - order[b.Severity] })
	if findings != nil {
		rep.Findings = findings
	}
	rep.DurationMs = float64(time.Since(start).Microseconds()) / 1000
	return rep, nil
}

func newClient(cfg Config) *http.Client {
	dial := cfg.dial
	if dial == nil {
		d := &net.Dialer{Timeout: 8 * time.Second, Control: cfg.DialControl}
		dial = d.DialContext
	}
	return &http.Client{
		Timeout: 15 * time.Second,
		Transport: &http.Transport{
			Proxy:                 nil,
			DialContext:           dial,
			TLSClientConfig:       &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS10}, //nolint:gosec // looking for files, not judging the certificate
			TLSHandshakeTimeout:   8 * time.Second,
			ResponseHeaderTimeout: 10 * time.Second,
			MaxIdleConnsPerHost:   1,
		},
		// A redirect is never followed: a file that redirects isn't exposed there.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

type answer struct {
	status int
	ct     string
	body   []byte
}

func fetch(ctx context.Context, client *http.Client, url string) (answer, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return answer{}, err
	}
	req.Header.Set("User-Agent", "Qnetward-DeepScan/1.0 (authorized; +https://qnetward.com)")
	resp, err := client.Do(req)
	if err != nil {
		return answer{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	return answer{status: resp.StatusCode, ct: strings.ToLower(resp.Header.Get("Content-Type")), body: body}, nil
}

// exposedFiles requests each probe path on the host. A random path first
// shows what the site answers for things that don't exist, so a site that
// returns 200 for everything isn't reported for every file.
func exposedFiles(ctx context.Context, client *http.Client, host string, gap time.Duration) ([]Finding, int, error) {
	base := ""
	requests := 0
	for _, scheme := range []string{"https", "http"} {
		if _, err := fetch(ctx, client, scheme+"://"+host+"/"); err == nil {
			base = scheme + "://" + host
			requests++
			break
		}
		requests++
	}
	if base == "" {
		return nil, requests, errors.New("no web server answered")
	}

	nonce := make([]byte, 8)
	_, _ = rand.Read(nonce)
	baseline, err := fetch(ctx, client, base+"/qnetward-"+hex.EncodeToString(nonce)+".txt")
	requests++
	if err != nil {
		return nil, requests, err
	}

	var out []Finding
	seen := map[string]bool{}
	for _, p := range probes {
		select {
		case <-ctx.Done():
			return out, requests, ctx.Err()
		case <-time.After(gap):
		}
		a, err := fetch(ctx, client, base+p.path)
		requests++
		if err != nil || a.status != http.StatusOK || len(a.body) == 0 {
			continue
		}
		// The same answer the site gives for nonsense isn't a hit.
		if baseline.status == http.StatusOK && bytes.Equal(a.body, baseline.body) {
			continue
		}
		if !p.match(a.body, a.ct) || seen[p.id] {
			continue
		}
		seen[p.id] = true
		out = append(out, Finding{Host: host, URL: base + p.path, Finding: passive.Finding{
			ID: p.id, Category: "exposure", Severity: p.severity, Title: p.title,
			Detail: fmt.Sprintf("%s answered with the file's contents. %s The contents were not stored.", base+p.path, p.why),
			Fix:    "Remove the file from the web root, or block the path in the web server, then rotate any secret it held.",
		}})
	}
	return out, requests, nil
}
