# 21. Probe agents enroll with one-time tokens and connect outbound

## Status

Accepted. First step of probe agents; running checks through them follows.

## Context

Every check runs from the API server. That can't reach a customer's private
network, which our SSRF policy blocks anyway, and it sees the internet from
one place only. Agents fix both, but each is a program on someone else's
machine holding credentials to our API.

## Decision

- An agent is the existing CLI, `qnetward agent`, so it shares the probe
  engines and ships as one binary.
- An owner or admin creates the agent in the console and gets an enrollment
  token (`qne_…`) that works once, for one hour. The agent trades it for its
  own secret (`qna_…`), saved in a file only its user can read. Only SHA-256
  hashes of either are stored (migration 0020), and neither is ever listed.
- Agents only call out, over HTTPS: `POST /api/agent/enroll` once, then
  `POST /api/agent/heartbeat` every 30 seconds with the secret as a bearer
  token. Nothing needs to reach the agent, so no firewall changes. The
  heartbeat answer will carry checks to run.
- Removing an agent deletes its row, so its secret stops working at once and
  the running agent exits with a message to enroll again.
- Plans cap agents: Free 2, Pro 20, Enterprise 200. Enrollment is rate
  limited per address.

## Consequences

- A check an agent runs may target private addresses: that is the point, and
  it is the customer's own network. The server's SSRF policy still applies to
  checks the server runs.
- Our own regions will be agents we run, offered to every workspace.
