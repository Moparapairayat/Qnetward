# 29. Compliance maps external scan evidence to framework controls

## Status

Accepted

## Context

Customers preparing for audits want to know how their scan results bear on CIS Controls, PCI DSS, ISO 27001, and SOC 2. Most of those frameworks' requirements are about process, people, and internal systems, which Qnetward can't see. Claiming a "SOC 2 score" from outside scans would mislead.

## Decision

- `internal/compliance` holds a fixed catalog of 16 controls Qnetward can actually observe from outside: encryption in transit, TLS versions, certificates, HTTPS enforcement, browser headers, cookies, version disclosure, email authentication, DNS integrity, asset inventory, exposed services, dangling DNS, known vulnerabilities, scheduled scanning, exposed files, and availability monitoring.
- Each control lists the requirement it gives evidence for in each framework (for example CIS 9.5 and PCI DSS 5.4.1 for DMARC). A framework is left out of a control when no requirement fits closely.
- Status is computed on request, not stored: the newest finished scan of each kind per domain from the last 30 days. A high finding fails a control, medium or low needs attention, nothing found passes, and no relevant scan is "not assessed". Vulnerabilities marked false positive are ignored; accepted risks count as needing attention.
- A framework's percentage is passing controls out of assessed ones, shown next to how many controls are mapped, so a small sample can't look like full coverage.
- `GET /api/security/compliance` returns the evaluation; `?format=csv` returns it as a spreadsheet with evidence lines and scan ids for auditors.
- The page and the export both say this is evidence, not a certification.

## Consequences

- No new tables; results always match the latest scans.
- Adding a control means adding finding prefixes and references in one place.
- Process controls (policies, training, access reviews) stay out until there is a way to collect evidence for them.
