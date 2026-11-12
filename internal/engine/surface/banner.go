package surface

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Service is what answered on an open port, as far as its own greeting says.
type Service struct {
	Port    int    `json:"port"`
	Banner  string `json:"banner,omitempty"`
	Product string `json:"product,omitempty"`
	Version string `json:"version,omitempty"`
	// CPE names the product for vulnerability databases, when it's known.
	CPE string `json:"cpe,omitempty"`
}

const bannerTimeout = 3 * time.Second

// grabBanner asks the service what it is, the way any client would on
// connecting: an HTTP request, or reading the greeting SSH, FTP, SMTP, and
// MySQL send first. It never sends credentials or anything unusual.
func grabBanner(ctx context.Context, cfg Config, host, addr string, port int) Service {
	s := Service{Port: port}
	ctx, cancel := context.WithTimeout(ctx, bannerTimeout)
	defer cancel()
	conn, err := cfg.dial(ctx, "tcp", net.JoinHostPort(addr, strconv.Itoa(port)))
	if err != nil {
		return s
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(bannerTimeout))

	switch port {
	case 80, 8080:
		s.Banner = httpServerHeader(conn, host)
	case 443, 8443:
		tc := tls.Client(conn, &tls.Config{ServerName: host, InsecureSkipVerify: true, MinVersion: tls.VersionTLS10, //nolint:gosec // only reading the Server header
			CurvePreferences: []tls.CurveID{tls.X25519, tls.CurveP256, tls.CurveP384}})
		if tc.HandshakeContext(ctx) == nil {
			s.Banner = httpServerHeader(tc, host)
		}
	case 3306:
		s.Banner = mysqlVersion(conn)
	case 21, 22, 25:
		line, _ := bufio.NewReaderSize(io.LimitReader(conn, 512), 512).ReadString('\n')
		s.Banner = strings.TrimSpace(line)
	}
	s.Banner = clean(s.Banner)
	s.Product, s.Version, s.CPE = identify(port, s.Banner)
	return s
}

// httpServerHeader sends a plain GET and returns the Server and X-Powered-By
// headers of the answer.
func httpServerHeader(conn net.Conn, host string) string {
	fmt.Fprintf(conn, "GET / HTTP/1.1\r\nHost: %s\r\nUser-Agent: Qnetward-AttackSurface/1.0\r\nAccept: */*\r\nConnection: close\r\n\r\n", host)
	resp, err := http.ReadResponse(bufio.NewReader(io.LimitReader(conn, 64<<10)), nil)
	if err != nil {
		return ""
	}
	resp.Body.Close()
	parts := []string{}
	if v := resp.Header.Get("Server"); v != "" {
		parts = append(parts, v)
	}
	if v := resp.Header.Get("X-Powered-By"); v != "" {
		parts = append(parts, v)
	}
	return strings.Join(parts, " ")
}

// mysqlVersion reads the server version from MySQL's handshake packet,
// which the server sends before the client says anything.
func mysqlVersion(conn net.Conn) string {
	buf := make([]byte, 128)
	n, _ := io.ReadAtLeast(conn, buf, 6)
	if n < 6 || buf[4] != 10 {
		return ""
	}
	end := strings.IndexByte(string(buf[5:n]), 0)
	if end < 0 {
		return ""
	}
	return "MySQL " + string(buf[5:5+end])
}

func clean(s string) string {
	s = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return ' '
		}
		return r
	}, s)
	s = strings.TrimSpace(s)
	if len(s) > 160 {
		s = s[:160]
	}
	return s
}

type signature struct {
	re      *regexp.Regexp
	product string
	cpe     string // vendor:product
}

// signatures recognise common software from its banner. The first group is
// the version.
var signatures = []signature{
	{regexp.MustCompile(`(?i)\bnginx/(\d+\.\d+\.\d+)`), "nginx", "f5:nginx"},
	{regexp.MustCompile(`(?i)\bApache/(\d+\.\d+\.\d+)`), "Apache httpd", "apache:http_server"},
	{regexp.MustCompile(`(?i)Microsoft-IIS/(\d+\.\d+)`), "Microsoft IIS", "microsoft:internet_information_services"},
	{regexp.MustCompile(`(?i)\blighttpd/(\d+\.\d+\.\d+)`), "lighttpd", "lighttpd:lighttpd"},
	{regexp.MustCompile(`(?i)\bOpenSSH_(\d+\.\d+(?:\.\d+)?(?:p\d+)?)`), "OpenSSH", "openbsd:openssh"},
	{regexp.MustCompile(`(?i)\bvsFTPd (\d+\.\d+\.\d+)`), "vsftpd", "beasts:vsftpd"},
	{regexp.MustCompile(`(?i)\bProFTPD (\d+\.\d+\.\d+[a-z]?)`), "ProFTPD", "proftpd:proftpd"},
	{regexp.MustCompile(`(?i)\bExim (\d+\.\d+(?:\.\d+)?)`), "Exim", "exim:exim"},
	{regexp.MustCompile(`(?i)\bPHP/(\d+\.\d+\.\d+)`), "PHP", "php:php"},
	{regexp.MustCompile(`(?i)^MySQL (\d+\.\d+\.\d+)`), "MySQL", "oracle:mysql"},
	{regexp.MustCompile(`(?i)\bTomcat/(\d+\.\d+\.\d+)`), "Apache Tomcat", "apache:tomcat"},
}

// identify names the product and version a banner announces, and builds its
// CPE. A banner without a version can't be matched to vulnerabilities.
func identify(_ int, banner string) (product, version, cpe string) {
	for _, sig := range signatures {
		m := sig.re.FindStringSubmatch(banner)
		if m == nil {
			continue
		}
		version = m[1]
		cpeVersion, update := version, "*"
		// OpenSSH 8.2p1 is version 8.2, update p1, in CPE terms.
		if sig.product == "OpenSSH" {
			if i := strings.Index(version, "p"); i > 0 {
				cpeVersion, update = version[:i], version[i:]
			}
		}
		return sig.product, version, fmt.Sprintf("cpe:2.3:a:%s:%s:%s:*:*:*:*:*:*", sig.cpe, cpeVersion, update)
	}
	return "", "", ""
}
