# 24. Passive security checks grade a domain from public signals

## Status

Accepted. First step of security scanning (Phase 3), Tier 0.

## Context

The roadmap gates scanning in three tiers. Tier 0 must work for any domain
without proof of ownership, so it may only do what an ordinary visitor or
mail server does. Most real exposure at that level is configuration: an
expiring or untrusted certificate, old TLS versions, missing security
headers, and DNS that lets anyone send mail as the domain.

## Decision

- A new engine, `internal/engine/passive`, checks a domain in one pass:
  - **TLS:** one handshake for TLS 1.2+ (retried once), one for 1.0/1.1.
    The certificate is verified by hand so an untrusted one can still be
    described: trust, expiry, key size, signature algorithm.
  - **HTTP:** `http://` must redirect to `https://`; the final HTTPS
    response is checked for HSTS, CSP, framing protection, nosniff,
    Referrer-Policy, Permissions-Policy, version-revealing headers, and
    cookie flags. Redirects are followed by hand, at most five.
  - **Email and DNS:** SPF, DMARC (falling back to the organisational
    domain, from the public suffix list), CAA (closest name upward), and
    DNSSEC (a DS record at the parent). Large answers retry over TCP; a null
    MX means the domain takes no mail.
- Every finding has a severity (high, medium, low, info, pass), a plain
  explanation, and a fix. The score starts at 100 and loses 25, 10, and 4
  for each high, medium, and low; grades run A+ (100) to F. Any high keeps
  a domain out of A and B.
- Scans honour the SSRF policy: the domain's addresses are checked before
  anything connects, and every dial, redirects included, goes through it.
  IP addresses and public suffixes are refused.
- Handshakes leave out the post-quantum key share: some older servers drop
  the larger ClientHello, and a scan must reach every server a browser can.
- Scans are stored in `security_scans` (migration 0024, RLS like the rest)
  with the full report as JSON, kept 180 days, and listed per workspace.
- Limits: each scan counts towards the plan's hourly scan quota, and one
  workspace may check the same domain at most 12 times an hour, so we can't
  be used to hammer someone else's site. Each scan is in the audit log.

## Consequences

- Grades are guidance, not a pentest. They say nothing about the
  application behind the headers.
- Watched domains (migration 0025) re-run the check every 6 hours, daily,
  or weekly, claimed like monitors so instances share the work. They don't
  spend the hourly scan quota; plans cap how many there are (Free 3, Pro 25,
  Enterprise 250). A watch alerts, by email and on channels subscribed to
  `security`, when the grade drops or a high-severity finding appears that
  the previous scan didn't have. Getting better doesn't alert.
- Tier 1 checks on verified domains build on this table and engine.
