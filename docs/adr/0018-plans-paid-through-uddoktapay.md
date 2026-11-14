# 18. Paid plans through UddoktaPay, bought a period at a time

## Status

Accepted. Builds on [ADR 0014](0014-plans-and-quotas.md).

## Context

Pro had no way to be bought; an admin set plans by hand. Most of our first
customers pay with bKash, Nagad, or Rocket, which global processors don't
take, and Stripe doesn't serve businesses registered in Bangladesh.
UddoktaPay covers those methods and bank cards, but it only does one-time
payments: there are no subscriptions, and its webhook is sent by hand from
its dashboard rather than on every payment.

## Decision

- A payment buys a **period** of a plan: Pro for one or twelve months, priced
  in taka (`QNETWARD_PRO_MONTHLY_BDT`, `QNETWARD_PRO_YEARLY_BDT`). It sets
  `workspaces.plan_expires_at`; paying again adds after the current period.
  The hourly maintenance pass returns expired workspaces to Free, keeping
  their data. A plan set by an admin has no expiry.
- What a plan covers is what runs (added 2026-11-14). A workspace back on Free
  keeps every monitor, status page, device, and host alert rule, but only the
  oldest ones up to Free's limits are checked, served, polled, or evaluated;
  the rest wait, marked "over your plan's limit" in the console. Nothing is
  deleted or flagged in the database (`internal/store/plan_caps.go` ranks by
  age against the plan catalog), so paying again resumes them at once, and
  turning one off lets the next one in. Without this, one paid month would
  keep Pro's capacity running for good.
- Checkout creates a `payments` row first (migration 0018), then an
  UddoktaPay charge whose metadata carries the payment and workspace IDs.
- The outcome is only ever taken from UddoktaPay's `verify-payment` API, both
  when the browser returns and when the webhook arrives. A payment applies
  only if it is `COMPLETED`, names the same workspace, and covers the price;
  `PENDING` (manual bank transfer) waits. Completing a payment is a single
  conditional update, so a repeated return or webhook can't add time twice.
- The webhook must carry our API key in `RT-UDDOKTAPAY-API-KEY`, compared in
  constant time, and is still re-verified.
- The browser returns to the allowed origin the checkout came from, so local
  and staging consoles don't land on production.
- Owners and admins pay; every checkout and completed payment is audited.
  Without `QNETWARD_UDDOKTAPAY_URL` and `QNETWARD_UDDOKTAPAY_API_KEY`, the
  billing page says online payment isn't set up.

## Consequences

- No auto-renewal: customers renew by paying again, and the billing page
  shows the paid-through date. Reminder emails before expiry are a follow-up.
- Prices on the landing page are written out and must be kept in step with
  the configured prices.
