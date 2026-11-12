# 27. Vulnerabilities are matched from the versions services announce

## Status

Accepted. Builds on the attack surface scans of ADR 0026.

## Context

Knowing a port is open says little; knowing it runs Apache 2.4.49 says a lot.
Many services announce their software and version in their first answer, and
public databases list the known vulnerabilities of each version.

## Decision

- During an attack surface scan, open ports 21, 22, 25, 80, 443, 3306,
  8080, and 8443 are asked what they are the way any client would: an HTTP
  GET (Server and X-Powered-By), or the greeting SSH, FTP, SMTP, and MySQL
  send first. Nothing else is sent.
- A short list of signatures turns banners into a product, a version, and a
  CPE (nginx, Apache httpd, IIS, lighttpd, OpenSSH, vsftpd, ProFTPD, Exim,
  PHP, MySQL, Tomcat). A banner without a version is never matched.
- `internal/platform/vulndb` looks each CPE up in NVD
  (`virtualMatchString`, so version ranges match), marks CVEs in CISA's
  Known Exploited Vulnerabilities catalogue, and adds FIRST's EPSS score.
  Severity puts exploitation first: critical when exploited or CVSS 9+,
  high at CVSS 7+ or EPSS 10%+. Answers are cached for a day and NVD calls
  are paced to its public limit (5 per 30 s, or 50 with
  `QNETWARD_NVD_API_KEY`).
- Each scan's report carries its vulnerabilities, and one finding per host
  and product sums them up, so new exposure alerts (ADR 0026) cover them.
- The Vulnerabilities page lists the latest scan of each domain, worst
  first. Owners and admins can mark one "risk accepted" or "false positive"
  with a reason (`vuln_dispositions`, migration 0029); it stays listed but
  out of the way, and can be reopened. Both are in the audit log.

## Consequences

- Version matching gives false positives: distributions such as Debian and
  Ubuntu backport fixes without changing the version. The page says so and
  the false-positive mark exists for it.
- Servers that hide their version can't be matched. Authenticated or
  intrusive checks belong to Tier 2.
