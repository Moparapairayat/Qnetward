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
