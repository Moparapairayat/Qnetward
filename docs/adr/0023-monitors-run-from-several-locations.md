# 23. Monitors run from several locations

## Status

Accepted. Builds on ADR 0022.

## Context

A monitor ran from one place: our servers or one agent. A single vantage
point can't tell "the service is down" from "the path from here is broken",
so it raises false alarms, and it says nothing about how the service looks
from a customer's office or another region.

## Decision

- A monitor has one or more locations (`monitor_locations`, migration 0023):
  our servers ("cloud", no agent) and any of the workspace's agents. This
  replaces `monitors.agent_id`. `monitors.cloud` mirrors "has a cloud
  location" so the scheduler's claim stays one indexed lookup.
- Each location keeps its own latest status, time, latency, and error.
  Every check already records which agent ran it.
- The monitor's status comes from the locations that are still reporting:
  **up** when any of them sees it up, **down** only when every one sees it
  down. While some are down and others haven't reported yet, it stays as it
  was. Alerts follow that status, so one failing location among several
  doesn't alert; the console shows it in yellow instead.
- An agent that stopped checking in (90 seconds) doesn't count: its stale
  "up" can't hold a monitor up. The agent-offline alert covers that case.
- Plans cap locations per monitor: Free 2, Pro 5, Enterprise 20.
- Removing an agent removes its locations. A monitor left with none goes
  back to the servers.
- The API takes `locations` (0 for the servers, or agent ids). The older
  `agent_id` still works for one place.

## Consequences

- A monitor with one location behaves exactly as before.
- The response-time chart and uptime figure mix checks from all locations;
  per-location charts can come later from `monitor_checks.agent_id`.
- "Alert when any location is down" is not offered. It can be a per-monitor
  option if someone needs it.
