# 15. Two-factor sign-in with TOTP

## Status

Accepted.

## Context

The plan lists TOTP MFA and passkeys as enterprise requirements, and a
password alone is weak protection for a tool that can scan networks.

## Decision

- Users can add an authenticator app (RFC 6238: SHA-1, six digits, 30-second
  steps), implemented in `internal/platform/totp` and checked against the
  RFC's test vectors. One step of drift either way is accepted.
- Setup needs the password and stays inactive until a first code is
  confirmed. Confirming returns ten one-time recovery codes; only their
  SHA-256 hashes are stored. Turning it off or replacing the codes needs the
  password and a current code or a recovery code.
- With two-factor on, a correct password returns `mfa_required` and a token
  instead of a session. `/api/auth/mfa` exchanges the token and a code for
  the session. Tokens last five minutes and allow five attempts, and the
  endpoint is rate-limited by address. The last accepted time step is stored,
  so a code can't be used twice.
- Seeds are encrypted with AES-256-GCM (`internal/platform/secretbox`) under
  `QNETWARD_ENCRYPTION_KEY`, a base64 32-byte key. Without a key, seeds are
  stored marked as plain text and the server warns at startup; production
  must set the key. Changing the key makes existing seeds unreadable, so
  rotation needs a re-encryption step that doesn't exist yet.
- The QR code is drawn on the server (`skip2/go-qrcode`) and returned as a
  data URL, so the browser needs no extra library.
- Enabling, disabling, new recovery codes, recovery-code sign-ins, and wrong
  codes are recorded in the account's audit trail.

## Consequences

- Platform admins can't yet require two-factor sign-in for a workspace.
- Passkeys (WebAuthn) remain on the roadmap; the sign-in step added here is
  where they will plug in.
- API keys are unaffected: they are already a separate secret per script.
