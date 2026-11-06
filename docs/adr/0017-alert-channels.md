# 17. Alert channels for chat tools and webhooks

## Status

Accepted. Builds on [ADR 0010](0010-uptime-monitors-run-in-process.md).

## Context

Monitors and alert rules only sent email. Teams watch Slack, Discord, or
Telegram, and want alerts to reach their own systems too. The destinations are
secrets: a Slack or Discord webhook URL, or a Telegram bot token, is enough
to post as the workspace.

## Decision

- A workspace has up to 20 **channels** (migration 0016, under the same
  row-level security as other workspace data). A channel is Slack, Discord,
  Telegram, or a generic webhook, and subscribes to any of three groups:
  monitors going down or up, certificates about to expire, and alert rules
  firing or clearing. Every enabled channel gets its groups for every monitor
  in the workspace; there is no per-monitor routing yet.
- The destination is sealed with `QNETWARD_ENCRYPTION_KEY` (secretbox, as for
  TOTP seeds). The API only ever returns a masked hint, such as the last four
  characters. Editing a channel can leave the destination blank to keep it.
- Webhooks get a `whsec_` signing secret, shown once at creation. Each POST
  carries `X-Qnetward-Timestamp` and `X-Qnetward-Signature: sha256=<hex>`,
  the HMAC-SHA256 of `timestamp + "." + body`.
- Delivery happens in a goroutine after the check is recorded, through the
  same netguard dial policy as probes, so a webhook can't reach private or
  metadata addresses. Redirects aren't followed. A network error, 429, or 5xx
  is retried once after a second. The last success time and last error are
  stored on the channel and shown in the UI; error text never contains the
  destination URL or token.
- Slack and Discord URLs must be their official webhook hosts. Telegram uses
  the Bot API with the workspace's own bot token, so we don't run a shared
  bot.
- Owners and admins manage channels from Settings → Integrations, through a
  stepped dialog that ends with a test message. Changes are audited.

## Consequences

- Email per monitor keeps working; channels add to it.
- A burst of alerts sends one request per channel per alert. Grouping and
  per-monitor routing belong with incidents (Phase 3).
- Without an encryption key, destinations are stored in plain text, as with
  TOTP seeds; production must set the key.
