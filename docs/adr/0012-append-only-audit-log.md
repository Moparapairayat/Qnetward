# 12. An append-only audit log in PostgreSQL

## Status

Accepted.

## Context

Selling to teams, and running security scans at all, needs a record of who
did what and when that nobody can quietly change. The plan lists an
immutable audit log as a platform requirement and makes one mandatory before
any active scan.

## Decision

- Events go to the `audit_events` table (migration 0008). Workspace events
  carry the workspace; account events (sign-ins, failed sign-ins, password and
  session changes) have none and belong to the user.
- A trigger rejects every `UPDATE`, for every role. The tenant role can only
  `SELECT` and `INSERT`, and only within its workspace through the
  `workspace_isolation` policy. Deletes happen only as the login role: the
  hourly maintenance pass drops events older than a year, and deleting a
  workspace removes its events.
- Handlers call `recordAudit` after the change succeeds. A failed audit write
  is logged and does not fail the request, because the change has already
  happened. Each event stores the actor's ID and email at the time, the
  client IP and user agent, a target, and small JSON metadata. The actor has
  no foreign key, so the record outlives the account.
- Recorded today: sign-in, failed sign-in, sign-out, email verification,
  password change, session sign-outs; invitations, joins, role changes, and
  removals; monitor and alert rule changes; port scans; history exports.
- Workspace owners and admins read the log at `/api/workspace/audit`, newest
  first, with a category filter and an ID cursor. Users read their own
  account events at `/api/account/activity`.

## Consequences

- The table is the source for the scan audit trail the security phase needs.
- Because the write is not in the same transaction as the change, a crash
  between the two can lose an entry. Moving writes into the change's
  transaction is possible later for the actions that need it.
- The login role can still delete rows. Stronger guarantees, such as shipping
  events to write-once storage, are an enterprise-phase option.
