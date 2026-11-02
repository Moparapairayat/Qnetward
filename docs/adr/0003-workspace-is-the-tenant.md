# 3. The workspace is the tenant boundary

## Status

Accepted

## Context

Qnetward is SaaS-first and must serve teams, MSPs with many clients, and
eventually enterprises. Data has to be isolated between customers, and a user
can belong to more than one customer's account.

The product plan describes an Organization → Project → Environment hierarchy.
The code already has workspaces with members, roles (owner, admin, member),
invitations, and an active workspace per session.

## Decision

A workspace is the unit of tenancy. Every customer-owned row will carry the
workspace it belongs to, and authorization checks are made against the user's
role in that workspace. A user can belong to several workspaces and switches
between them; the active workspace is stored on the session.

Projects and environments, if needed later, will live inside a workspace
rather than above it.

Isolation is enforced in application queries, with PostgreSQL row-level
security underneath for workspace-owned tables (see
[ADR 0009](0009-row-level-security-via-tenant-role.md)).

## Consequences

- Every new table that holds customer data needs a workspace reference and
  scoped queries from day one.
- Probe results and alert rules belong to the workspace they were created in
  (migration 0004 and `scopeResultsToWorkspaces`). Rows from before that move
  to their author's personal workspace. Each row still records the user who
  created it; alert rules keep the row with no author if that user deletes
  their account.
- An open WebSocket keeps the workspace it connected with. The console opens a
  new connection per run, so a switch applies from the next run.
- Store helpers named `...ByUserID` pick the user's own workspace implicitly.
  They exist for tests only; handlers must pass an explicit workspace ID.
- Each workspace has a `data_region` (migration 0011), `ap-southeast-1` for
  all of them today. Data residency can be added later by routing on it,
  without changing how tenants are shaped.
