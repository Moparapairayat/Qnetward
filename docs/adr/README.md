# Architecture Decision Records

This directory records decisions that are expensive to reverse, cut across
packages, or need their reasoning kept alongside the code.

Each record is one numbered Markdown file with four parts: status, context,
decision, consequences. To change a decision, write a new ADR that supersedes
the old one and update the old one's status. Don't rewrite history in place.

Not every change needs an ADR. Bug fixes and endpoints that follow existing
patterns don't.

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-modular-monolith-layout.md) | Modular monolith with engine / platform / modules layers | Accepted, amended by 0008 |
| [0003](0003-workspace-is-the-tenant.md) | The workspace is the tenant boundary | Accepted, RLS in 0009 |
| [0004](0004-probe-target-policy.md) | Block probes to private and metadata addresses by default | Accepted |
| [0005](0005-database-environments.md) | Neon for development, TimescaleDB optional | Accepted |
| [0006](0006-marketing-and-console-in-one-app.md) | Marketing site and console in one Next.js app | Accepted |
| [0007](0007-versioned-schema-migrations.md) | Versioned, embedded schema migrations | Accepted |
| [0008](0008-http-layer-in-internal-api.md) | One HTTP package, domain packages on demand | Accepted |
| [0009](0009-row-level-security-via-tenant-role.md) | Row-level security through a restricted tenant role | Accepted |
| [0010](0010-uptime-monitors-run-in-process.md) | Uptime monitors run inside the API process | Accepted |
| [0011](0011-ai-through-an-openai-compatible-api-key.md) | AI features call a hosted model through an OpenAI-compatible API | Accepted |
| [0012](0012-append-only-audit-log.md) | An append-only audit log in PostgreSQL | Accepted |
| [0013](0013-workspace-api-keys.md) | Workspace API keys with scopes | Accepted |
| [0014](0014-plans-and-quotas.md) | Plans and per-workspace quotas | Accepted |
| [0015](0015-totp-two-factor-sign-in.md) | Two-factor sign-in with TOTP | Accepted |
| [0016](0016-google-sign-in-and-passkeys.md) | Google sign-in and passkeys in our own auth | Accepted |
| [0017](0017-alert-channels.md) | Alert channels for chat tools and webhooks | Accepted |
| [0018](0018-plans-paid-through-uddoktapay.md) | Paid plans through UddoktaPay, bought a period at a time | Accepted |
| [0019](0019-public-status-pages.md) | Public status pages that never show what they watch | Accepted |
| [0020](0020-live-updates-over-server-sent-events.md) | Live updates over Server-Sent Events | Accepted |
| [0021](0021-probe-agents-enroll-with-one-time-tokens.md) | Probe agents enroll with one-time tokens and connect outbound | Accepted |
| [0022](0022-agents-run-monitors-they-are-assigned.md) | Agents run the monitors they are assigned | Accepted |
| [0023](0023-monitors-run-from-several-locations.md) | Monitors run from several locations | Accepted |
| [0024](0024-passive-security-checks.md) | Passive security checks grade a domain from public signals | Accepted |
| [0025](0025-domain-ownership-gates-deeper-checks.md) | Proof of domain ownership gates deeper checks | Accepted |
| [0026](0026-attack-surface-scans.md) | Attack surface scans map a verified domain's exposure | Accepted |
| [0027](0027-vulnerabilities-from-service-versions.md) | Vulnerabilities are matched from the versions services announce | Accepted |
| [0028](0028-deep-scans-need-consent-and-approval.md) | Deep scans need signed consent and an admin's approval | Accepted |
| [0029](0029-compliance-maps-external-evidence.md) | Compliance maps external scan evidence to framework controls | Accepted |
| [0030](0030-host-metrics-from-agents.md) | Host metrics come from the probe agent | Accepted |
