# 22. Agents run the monitors they are assigned

## Status

Accepted. Second step of probe agents, after ADR 0021.

## Context

Agents could enroll and check in, but every check still ran from the server.
The point of an agent is to check from where it sits: inside a private
network, or from another part of the world.

## Decision

- A monitor runs from one place: the server, or one of the workspace's
  agents (`monitors.agent_id`, migration 0021). Saving checks that the agent
  belongs to the workspace, since the foreign key alone would accept any.
- The server's scheduler skips monitors that have an agent.
- The heartbeat answer lists the agent's enabled monitors. The agent
  schedules them itself, on their intervals, and a change in the console
  reaches it within one heartbeat (30 seconds).
- The agent sends finished checks to `POST /api/agent/results` every few
  seconds, in batches of up to 100, and keeps up to 500 while the console is
  unreachable. The server records a result only for a monitor that runs from
  that agent, drops results older than an hour, and then treats it exactly
  like its own check: status, emails, chat alerts, live updates.
- Each check stores the agent that ran it (`monitor_checks.agent_id`).
- Agents run checks without the server's SSRF policy: reaching the private
  network they sit in is what they are for, and it is the customer's network.
- Removing an agent hands its monitors back to the server.

## Consequences

- An offline agent's monitors keep their last status, and the console flags
  them. When an agent that runs monitors misses check-ins for three minutes,
  the workspace is told once, by email to whoever added the agent and on
  channels subscribed to `agents` (migration 0022), and again when it's back.
- Ping and TCP checks from an agent carry their samples, which land in
  History and feed alert rules like the server's own. The server works out
  loss and latency from the samples itself.
- Running one monitor from several places at once, with a result per
  location, builds on the per-check agent id and is a later step.
