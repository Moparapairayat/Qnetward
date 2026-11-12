# 25. Proof of domain ownership gates deeper checks

## Status

Accepted. Security Tier 1, after the passive checks of ADR 0024.

## Context

Finding subdomains and probing their open ports is more than an ordinary
visitor does. Run against someone else's domain, it is reconnaissance we'd be
doing on a stranger's behalf. The roadmap's Tier 1 allows it only on domains
the workspace has proved it controls.

## Decision

- A workspace adds a domain and gets its own random token (128 bits,
  `qnetward-verify=…`). Two workspaces adding the same domain each prove it
  with their own token. Only owners and admins add or remove domains; the
  shared demo can't.
- Proof is either a TXT record at `_qnetward-verify.<domain>` or the token
  alone in `https://<domain>/.well-known/qnetward-verify.txt` (plain HTTP
  also accepted). The file fetch goes through the SSRF policy and only
  follows redirects on the same host, so a redirect can't borrow another
  site's file.
- "Verify now" checks at once (60 a workspace per hour). A new domain is
  also looked at hourly for a week. A verified domain is re-checked daily;
  if its proof is missing, every 6 hours, and after a week without it the
  domain lapses and the workspace is told on `security` channels. Finding
  the proof again verifies it again.
- A verified domain covers itself and every name under it.
  `VerifiedDomainFor` is the one check deeper scans call, server side.
- Plans cap domains: Free 5, Pro 50, Enterprise 500. Adding, verifying, and
  removing are in the audit log. Stored in `verified_domains` (migration
  0026, RLS like the rest).

## Consequences

- Subdomain discovery and port checks (the attack surface) build on this
  and must call `VerifiedDomainFor` before touching a host.
- Lapsing after a week means a domain that changes hands stops being
  scannable by its old owner without anyone acting.
