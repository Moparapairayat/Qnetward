# 19. Public status pages that never show what they watch

## Status

Accepted. Builds on [ADR 0010](0010-uptime-monitors-run-in-process.md).

## Context

Customers ask "is it down?" during every incident. A status page answers
once, publicly. The risk is in what it reveals: a monitor's target is often an
internal hostname, an IP, or a URL with a token in it.

## Decision

- A workspace's pages (migration 0019) list chosen monitors under display
  names it picks. The public endpoint, `/api/public/status/{slug}`, returns
  only those names, each monitor's status, and daily check counts. It never
  selects a target, port, or URL, and a test checks the response for them.
- The slug is global and is the page's address, `/status/<slug>`. Unpublished
  pages answer 404, the same as pages that don't exist.
- History is daily for 30 days, because monitor checks are kept for 30 days.
  Longer history needs rolled-up daily rows, kept separately.
- The public read runs as the login role across workspaces, so it is a single
  narrow query by slug, cached for 30 seconds. The console page is server
  rendered and refreshes every minute.
- Plans cap pages: Free 1, Pro 10, Enterprise 100. The shared demo account
  can't publish, so nobody can put words on our domain through it.

## Consequences

- No incident posts or scheduled maintenance yet; those come with incidents.
- Custom domains (status.example.com) need TLS issuance and are not built.
