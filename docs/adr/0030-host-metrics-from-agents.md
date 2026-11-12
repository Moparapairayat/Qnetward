# 30. Host metrics come from the probe agent

## Status

Accepted. First step of the Infrastructure phase.

## Context

Customers want to see the load of the machines they run: CPU, memory, disk, and network. We already ship an outbound-only agent that enrolls with a token and authenticates with its own secret. A second agent would mean a second install, a second credential, and a second thing to keep updated.

## Decision

- The probe agent (0.2.0) also samples its own machine with gopsutil, which works on Linux, Windows, and macOS. `--host-metrics=false` (or `QNETWARD_AGENT_HOST_METRICS=false`) turns it off.
- The console sets the pace through `metrics_seconds` in the heartbeat reply (60 seconds now; 0 turns sampling off for every agent).
- Each sample carries CPU, load, memory, swap, every real disk (pseudo file systems skipped, at most 20), network throughput, process count, and uptime. The agent keeps up to 60 unsent samples, an hour at the default pace, while the console is unreachable.
- `POST /api/agent/metrics` takes up to 120 samples. The server clamps values, drops samples older than two hours, ignores duplicates by `(agent_id, at)`, and keeps only known, clipped fields of the machine description.
- `host_metrics` (migration 0031, RLS) keeps headline numbers per sample, with the fullest disk as the disk figure. The agent row keeps the newest full sample for the list. Samples are pruned after 14 days.
- `GET /api/hosts` lists hosts; `GET /api/hosts?id=&range=` returns history averaged into buckets (1 minute for an hour, up to 2 hours for 14 days) with `date_bin`.

## Consequences

- One agent, one credential, for both checks and host metrics.
- Threshold alerts on host metrics come next and can reuse the agent alert channels.
- Process and container lists are not collected yet.
