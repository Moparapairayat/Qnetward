# 16. Google sign-in and passkeys in our own auth

## Status

Accepted. Builds on [ADR 0015](0015-totp-two-factor-sign-in.md).

## Context

The sign-in page showed Google and passkey buttons marked "Soon". We looked
at moving authentication to a hosted provider such as Clerk and decided
against it: the plan includes self-hosted and air-gapped editions, which a
cloud-only identity service can't serve, and sessions, MFA, the audit log,
API keys, and row-level security are all keyed to our own users table.

## Decision

- **Google** uses the OAuth 2.0 authorization code flow with PKCE, written
  directly against the endpoints, so tests run a fake provider. State and
  verifier live in a ten-minute, HttpOnly, SameSite=Lax cookie. Only an email
  Google marks as verified is accepted. A Google account resolves to the
  account already linked to it, otherwise to the account with that email
  (which is then linked), otherwise to a new account with an unusable random
  password. Links are kept in `user_identities` (migration 0012). Accounts
  with two-factor sign-in still get the TOTP step, handed over in the URL
  fragment so the token never reaches a server log. Configure with
  `QNETWARD_GOOGLE_CLIENT_ID` and `QNETWARD_GOOGLE_CLIENT_SECRET`, and
  register `<QNETWARD_PUBLIC_BASE_URL>/api/auth/google/callback` with Google.
- **Passkeys** use `go-webauthn`. They are discoverable credentials with user
  verification required, so sign-in needs no email and counts as both factors:
  no TOTP step follows. Each user has a random 32-byte WebAuthn handle instead
  of their ID. Credentials and short-lived ceremony state are stored by
  migration 0013. Adding a passkey needs the password; a credential that
  reports a clone warning is refused.
- WebAuthn binds credentials to a domain name, so passkeys turn on only when
  `QNETWARD_PUBLIC_BASE_URL` is a domain. Development uses
  `http://localhost:…`, and the e2e suite runs on localhost so a virtual
  authenticator can exercise the full ceremony.
- `/api/auth/providers` tells the sign-in page which methods work; buttons
  for ones that aren't set up explain why instead of starting a flow.
- New sign-ins, sign-ups, and passkey changes are recorded in the account
  activity.

## Consequences

- Changing the public domain invalidates existing passkeys, which are bound
  to the old one.
- An account created with Google has no known password; its owner can set one
  with "Forgot your password?".
- Enterprise SSO (SAML) and SCIM are still to come, and can sit behind the
  same sign-in step.
