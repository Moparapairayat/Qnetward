# 13. Workspace API keys with scopes

## Status

Accepted.

## Context

The CLI, CI pipelines, and a future Terraform provider need to call the API
without a browser session. The plan asks for scoped API tokens.

## Decision

- A key belongs to one workspace and acts there, on behalf of the member who
  created it. Tokens are `qnw_` followed by 32 random bytes in base64url, so
  they are easy to recognise and to catch with secret scanners. Only the
  SHA-256 hash is stored (migration 0009); the token is shown once.
- Three scopes: `read` for GET requests and history export, `write` for
  changes to monitors and alert rules, and `probe` for running diagnostics.
  `requireActor` picks read or write from the method; probe handlers and the
  WebSocket ask for `probe` explicitly.
- Keys can't manage members, keys, or account settings: those endpoints need a
  browser session, and `requireActorFor` with an empty scope refuses keys.
  Only owners and admins create and revoke keys; the shared demo account
  can't create them. A workspace has at most 20 active keys.
- Keys can expire after 30, 90, or 365 days, or never. Revoked and expired
  keys stop working at once, since every request looks the key up. Use is
  recorded at most once a minute, or when the address changes.
- Creating and revoking keys is audited, and actions taken with a key are
  recorded under the key's name.
- `apps/web/public/openapi.yaml` describes the endpoints a key can call.

## Consequences

- Every key-authenticated request costs one indexed lookup. A short cache can
  be added if that shows up in latency, at the price of slower revocation.
- Rate limits per key and per workspace are still to come.
