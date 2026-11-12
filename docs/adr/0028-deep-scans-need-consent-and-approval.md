# 28. Deep scans need signed consent and an admin's approval

## Status

Accepted. Security Tier 2, the last tier of the roadmap's scanning gates.

## Context

Some of the most damaging exposures, such as a public .git folder, an .env
file, or a database dump left in the web root, can only be found by asking
for paths an ordinary visitor wouldn't. That is intrusive enough to need
more than proof of domain ownership: an explicit, recorded authorization
for an exact scope, and a human check before anything runs.

## Decision

- `internal/engine/deep` holds Tier 2 checks. The first, "exposed files",
  requests about 20 known-dangerous paths per host, one at a time with a
  300 ms gap, never following redirects. A random path first shows what the
  site answers for nonsense, so a catch-all page isn't reported; each hit
  must also match the file's content (`ref: refs/` for .git/HEAD, secret
  names in .env, ZIP and gzip magic bytes, SQL statements). Contents are
  never stored.
- A request names a verified domain, up to 20 hosts under it, the checks,
  and a 24-hour, 3-day, or 7-day window. The server writes the
  authorization text from exactly those details plus the signer's name; the
  console shows it, and the submission carries its SHA-256. The server
  rebuilds the text and refuses a hash that doesn't match, so the signature
  covers what will run. The text, hash, name, address, and browser are kept
  in `deep_scan_requests` (migration 0030), never edited.
- Only owners and admins on Pro (10 in 30 days) or Enterprise (100) can
  request. Platform admins are emailed and review in Admin → Deep scan
  reviews; rejecting needs a note the requester sees. Nothing runs before
  approval.
- An approved request starts when its window opens and must finish before
  it closes. Right before each host is touched it must still be in the
  approved scope, still verified, and allowed by the SSRF policy. Requests
  whose window passes unrun expire.
- Results are saved as a `deep` scan; the requester is emailed and
  `security` channels are told. Requesting, cancelling, approving,
  rejecting are all in the audit log.

## Consequences

- The authorization text is ours, not legal advice; have counsel review it
  before selling Tier 2. Its version is part of the text and the record.
- Deep checks run from our servers. Heavier ones (full port scans, TLS
  weakness probes) should run from the customer's own agents, so they don't
  come from shared cloud addresses.
