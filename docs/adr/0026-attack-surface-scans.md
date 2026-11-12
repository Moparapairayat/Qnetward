# 26. Attack surface scans map a verified domain's exposure

## Status

Accepted. Security Tier 1, built on ADR 0025.

## Context

Most breaches start with something forgotten: a staging server, a database
port left open, a DNS record pointing at a deleted cloud resource. Finding
those means listing a domain's names and knocking on their service ports,
which is why it needs the ownership proof of ADR 0025.

## Decision

- `internal/engine/surface` maps a domain in one pass:
  - **Names:** the domain, names under it from certificate transparency
    logs (crt.sh, one retry on a server error), and about 50 common labels.
    Only names under the domain are kept; at most 100 hosts per scan.
  - **Resolution:** a name with no address is kept only when its CNAME
    points at a takeover-prone service (Heroku, GitHub Pages, S3, Azure, …)
    and the target no longer exists: a high "possible subdomain takeover".
  - **Policy:** addresses the SSRF policy blocks are listed ("public DNS
    reveals an internal address") but never probed.
  - **Ports:** 20 service ports per host by TCP connect, 2-second timeout,
    a few at a time. Each has a severity: databases, Docker, SMB, RDP, VNC,
    Telnet high; FTP medium; SSH and alternate web ports low.
  - **TLS:** hosts with 443 open get the passive TLS check; expired,
    untrusted, expiring, and legacy-only certificates are reported.
- The API runs a scan only when `VerifiedDomainFor` covers the domain,
  server side. Plans cap scans per hour (Free 2, Pro 10, Enterprise 50) and
  a workspace runs one at a time.
- Scans take minutes, so the API answers 202 with a running scan and works
  in the background; the row in `security_scans` (kind `surface`, migration
  0027 adds status and error) is filled in when done. Scans a restart cut
  short are marked failed when the server starts.
- The console compares a scan with the last one of the same domain and
  marks new hosts and newly open ports.

## Consequences

- A TCP connect shows a port accepts connections, not what answers or
  whether it needs a password; findings say "open to the internet", not
  "vulnerable".
- crt.sh is a free, best-effort service. When it fails the scan still runs
  on common names and says so.
- Scheduled surface scans with alerts on new exposure can reuse the watch
  machinery of ADR 0024.
