package passive

import (
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"
)

func dialer(cfg Config) func(ctx context.Context, network, address string) (net.Conn, error) {
	if cfg.dialContext != nil {
		return cfg.dialContext
	}
	d := &net.Dialer{Timeout: cfg.Timeout, Control: cfg.DialControl}
	return d.DialContext
}

// handshake connects to host:443 and completes a TLS handshake without
// verifying the certificate, so an untrusted one can still be described.
func handshake(ctx context.Context, cfg Config, host string, minV, maxV uint16) (tls.ConnectionState, error) {
	ctx, cancel := context.WithTimeout(ctx, cfg.Timeout)
	defer cancel()
	raw, err := dialer(cfg)(ctx, "tcp", net.JoinHostPort(host, "443"))
	if err != nil {
		return tls.ConnectionState{}, err
	}
	defer raw.Close()
	_ = raw.SetDeadline(time.Now().Add(cfg.Timeout))
	conn := tls.Client(raw, &tls.Config{
		ServerName:         host,
		MinVersion:         minV,
		MaxVersion:         maxV,
		CurvePreferences:   classicCurves,
		InsecureSkipVerify: true, //nolint:gosec // verified by hand below, so a bad certificate can be reported
	})
	if err := conn.HandshakeContext(ctx); err != nil {
		return tls.ConnectionState{}, err
	}
	return conn.ConnectionState(), nil
}

// classicCurves leaves out the post-quantum key share, whose large
// ClientHello some older servers and middleboxes drop. Scans need to reach
// every server a browser can.
var classicCurves = []tls.CurveID{tls.X25519, tls.CurveP256, tls.CurveP384}

func checkTLS(ctx context.Context, cfg Config, domain string, info *TLSInfo) []Finding {
	state, err := handshake(ctx, cfg, domain, tls.VersionTLS12, tls.VersionTLS13)
	if err != nil && ctx.Err() == nil {
		// One retry, so a slow or briefly busy server isn't graded as broken.
		state, err = handshake(ctx, cfg, domain, tls.VersionTLS12, tls.VersionTLS13)
	}
	if err != nil {
		info.Error = cleanNetErr(err)
		// Some servers only speak TLS 1.0 or 1.1; that is worse than no HTTPS.
		if old, oldErr := handshake(ctx, cfg, domain, tls.VersionTLS10, tls.VersionTLS11); oldErr == nil {
			info.Available, info.LegacyAccepted = true, true
			info.Version = tls.VersionName(old.Version)
			return []Finding{{ID: "tls.legacy_only", Category: CategoryTLS, Severity: High,
				Title: "HTTPS works only over old TLS versions", Detail: "The server speaks " + info.Version + " but not TLS 1.2 or 1.3. Browsers refuse it.",
				Fix: "Enable TLS 1.2 and 1.3 on the server, and turn off 1.0 and 1.1."}}
		}
		return []Finding{{ID: "tls.unavailable", Category: CategoryTLS, Severity: High,
			Title: "HTTPS isn't available", Detail: "Connecting to " + domain + " on port 443 failed: " + info.Error + ".",
			Fix: "Serve the site over HTTPS with a certificate from a public CA, such as a free one from Let's Encrypt."}}
	}
	info.Available = true
	info.Version = tls.VersionName(state.Version)
	info.Cipher = tls.CipherSuiteName(state.CipherSuite)

	var out []Finding
	if len(state.PeerCertificates) == 0 {
		return append(out, Finding{ID: "tls.no_cert", Category: CategoryTLS, Severity: High, Title: "The server sent no certificate"})
	}
	leaf := state.PeerCertificates[0]
	info.Cert = describeCert(leaf)

	inter := x509.NewCertPool()
	for _, c := range state.PeerCertificates[1:] {
		inter.AddCert(c)
	}
	_, verr := leaf.Verify(x509.VerifyOptions{DNSName: domain, Roots: cfg.RootCAs, Intermediates: inter})
	info.Trusted = verr == nil
	days := info.Cert.DaysLeft
	switch {
	case time.Now().After(leaf.NotAfter):
		info.TrustError = "expired"
		out = append(out, Finding{ID: "tls.cert.expired", Category: CategoryTLS, Severity: High,
			Title: "The certificate has expired", Detail: fmt.Sprintf("It expired on %s. Browsers show a full-page warning.", leaf.NotAfter.UTC().Format("2 Jan 2006")),
			Fix: "Renew the certificate, and automate renewal so it doesn't lapse again."})
	case verr != nil:
		info.TrustError = trustReason(verr)
		out = append(out, Finding{ID: "tls.cert.untrusted", Category: CategoryTLS, Severity: High,
			Title: "Browsers don't trust the certificate", Detail: info.TrustError + ".",
			Fix: "Install a certificate for " + domain + " from a public CA, with its full intermediate chain."})
	case days < 14:
		out = append(out, Finding{ID: "tls.cert.expiring", Category: CategoryTLS, Severity: High,
			Title: fmt.Sprintf("The certificate expires in %d days", days), Fix: "Renew it now, and check that automatic renewal works."})
	case days < 30:
		out = append(out, Finding{ID: "tls.cert.expiring", Category: CategoryTLS, Severity: Medium,
			Title: fmt.Sprintf("The certificate expires in %d days", days), Fix: "Renew it soon, or check that automatic renewal is set up."})
	default:
		out = append(out, Finding{ID: "tls.cert.ok", Category: CategoryTLS, Severity: Pass,
			Title: fmt.Sprintf("Trusted certificate, valid for %d more days", days)})
	}

	switch {
	case info.Cert.KeyType == "RSA" && info.Cert.KeyBits < 2048:
		out = append(out, Finding{ID: "tls.cert.weak_key", Category: CategoryTLS, Severity: Medium,
			Title: fmt.Sprintf("Weak %d-bit RSA key", info.Cert.KeyBits), Fix: "Reissue the certificate with a 2048-bit RSA or an ECDSA key."})
	case strings.Contains(strings.ToUpper(info.Cert.SignatureAlgorithm), "SHA1") || strings.Contains(strings.ToUpper(info.Cert.SignatureAlgorithm), "MD5"):
		out = append(out, Finding{ID: "tls.cert.weak_signature", Category: CategoryTLS, Severity: Medium,
			Title: "The certificate uses a broken signature algorithm", Detail: info.Cert.SignatureAlgorithm + " can be forged.", Fix: "Reissue it with a SHA-256 signature."})
	}

	if old, err := handshake(ctx, cfg, domain, tls.VersionTLS10, tls.VersionTLS11); err == nil {
		info.LegacyAccepted = true
		out = append(out, Finding{ID: "tls.legacy", Category: CategoryTLS, Severity: Medium,
			Title: "TLS 1.0 or 1.1 is still accepted", Detail: "The server agreed to " + tls.VersionName(old.Version) + ". These versions have known weaknesses and every major browser has dropped them.",
			Fix: "Turn off TLS 1.0 and 1.1 on the server; keep 1.2 and 1.3."})
	} else {
		out = append(out, Finding{ID: "tls.versions.ok", Category: CategoryTLS, Severity: Pass, Title: "Only TLS 1.2 and newer are accepted"})
	}
	if state.Version == tls.VersionTLS13 {
		out = append(out, Finding{ID: "tls.13", Category: CategoryTLS, Severity: Pass, Title: "TLS 1.3 is supported"})
	} else {
		out = append(out, Finding{ID: "tls.no_13", Category: CategoryTLS, Severity: Info,
			Title: "TLS 1.3 isn't offered", Detail: "TLS 1.3 is faster to connect and drops older ciphers.", Fix: "Enable TLS 1.3 on the server or CDN."})
	}
	return out
}

func describeCert(c *x509.Certificate) *CertInfo {
	info := &CertInfo{
		Subject:            c.Subject.CommonName,
		Issuer:             firstNonEmpty(c.Issuer.CommonName, strings.Join(c.Issuer.Organization, ", ")),
		Names:              c.DNSNames,
		NotBefore:          c.NotBefore.UTC(),
		NotAfter:           c.NotAfter.UTC(),
		DaysLeft:           int(time.Until(c.NotAfter).Hours() / 24),
		SignatureAlgorithm: c.SignatureAlgorithm.String(),
	}
	if info.Names == nil {
		info.Names = []string{}
	}
	switch k := c.PublicKey.(type) {
	case *rsa.PublicKey:
		info.KeyType, info.KeyBits = "RSA", k.N.BitLen()
	case *ecdsa.PublicKey:
		info.KeyType, info.KeyBits = "ECDSA", k.Curve.Params().BitSize
	case ed25519.PublicKey:
		info.KeyType = "Ed25519"
	default:
		info.KeyType = "unknown"
	}
	return info
}

func trustReason(err error) string {
	var host x509.HostnameError
	var unknown x509.UnknownAuthorityError
	var invalid x509.CertificateInvalidError
	switch {
	case errors.As(err, &host):
		return "It doesn't cover this name; it's for " + strings.Join(host.Certificate.DNSNames, ", ")
	case errors.As(err, &unknown):
		return "It isn't signed by a trusted authority, or its intermediate certificate is missing"
	case errors.As(err, &invalid):
		return "It isn't valid: " + invalid.Error()
	default:
		return err.Error()
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func cleanNetErr(err error) string {
	var opErr *net.OpError
	if errors.As(err, &opErr) && opErr.Err != nil {
		err = opErr.Err
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "refused"):
		return "connection refused"
	case strings.Contains(msg, "timeout") || strings.Contains(msg, "deadline"):
		return "timed out"
	}
	return msg
}
