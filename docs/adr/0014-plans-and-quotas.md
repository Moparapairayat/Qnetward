# 14. Plans and per-workspace quotas

## Status

Accepted.

## Context

The plan asks for plans, quotas, a billing hook, and noisy-neighbor
protection: one tenant's load must never reach another. Until now the only
limit was a fixed cap of 20 monitors, and rate limits were per IP address.

## Decision

- `internal/plans` defines Free, Pro, and Enterprise and their limits:
  monitors, API keys, members, probes and port scans per hour, and API
  requests per key per minute. `workspaces.plan` stores the ID. The value
  `starter`, and anything unknown, means Free, so a bad value never grants
  more.
- The plan rides on the request's actor. Stored limits (monitors, API keys)
  are checked in the same transaction as the insert. Members are checked when
  an invitation is created, with pending invitations counted.
- Rates use an in-process sliding window per workspace (`ws:<id>:probe`,
  `ws:<id>:scan`) and per key (`key:<id>`). Exceeding one returns 429 with
  `Retry-After`. Monitor checks are not counted; their cost is bounded by the
  monitor limit and the one-minute minimum interval.
- `/api/workspace/usage` reports the plan, every plan's limits, and current
  usage. Billing and plan shows it as meters.
- There are no payments yet. A platform admin moves a workspace between plans
  at `/api/admin/workspaces/plan`, which is audited. That endpoint is where a
  payment provider's webhook will set the plan later.

## Consequences

- With several API instances, each one counts rates on its own, so the
  effective hourly limit is the plan limit times the number of instances.
  Moving the counters to Redis fixes that when we scale out.
- History retention is still global; per-plan retention is future work.
