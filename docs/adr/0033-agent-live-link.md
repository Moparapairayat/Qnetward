# 33. Agents keep a live link for commands and Live mode

## Status

Accepted. Step three of the realtime work.

## Context

Agents asked the console for work every 30 seconds and sent host metrics once a minute. A new monitor or device waited up to 30 seconds to start, there was no way to run a check on demand, and a host or switch could only be seen at one-minute resolution.

## Decision

- Agent 0.4.0 keeps one outbound WebSocket open to `/api/agent/live`, authenticated by its secret like every agent call. It reconnects with backoff, stops trying for ten minutes against a console without the endpoint, and works exactly as before when the link is down.
- The console sends commands over it: `sync` (fetch the work list now; sent when monitors or devices change, through the audit hook), `run` and `run_device` (check now), `live` (stream this machine every second) and `live_device` (poll this device every two seconds), each lasting 90 seconds.
- Commands reach the agent wherever it is connected: an instance publishes them on the `qnetward_agent` NOTIFY channel and the one holding the agent's connection passes them on. Without a listener, the instance delivers to its own connections.
- Live mode readings come back over the same link, are cleaned like stored samples, and go to consoles as `host.live` and `device.live` events through the `qnetward_live` channel. They are not written to the event log or the metrics tables: a console that misses one shows the next, and the minute-by-minute samples are still stored as before.
- A host or device page that is open and visible asks for Live mode, renews it every minute, and lets it lapse when hidden or closed, so agents only stream while someone is watching.
- "Run now" on a monitor checks it from the servers and asks each agent location to check at once; it is rate limited to once per ten seconds per monitor.

## Consequences

- Changes take effect within a second instead of up to 30.
- Hosts can be watched at one-second resolution and switch interfaces at two seconds, with no extra storage.
- Live readings add NOTIFY traffic only while a page is open; each instance keeps the one LISTEN connection from step one.
