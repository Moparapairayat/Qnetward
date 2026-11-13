# 32. Live events go through a Postgres log with LISTEN/NOTIFY

## Status

Accepted. Step one of the realtime work.

## Context

Consoles learned about changes from an in-process hub, so an event raised on one API instance never reached browsers connected to another, and a console that lost its connection silently missed whatever happened meanwhile. Most pages fell back to polling every 30 to 60 seconds to stay correct.

We want updates to reach every console within a second, across instances, without missing any, and without adding a broker such as Redis or NATS to run and pay for.

## Decision

- Every live event is appended to `workspace_events` (migration 0034) and gets a global, increasing id. A trigger announces it with `pg_notify('qnetward_events', …)`; payloads over about 7.5 KB are announced by id and read back.
- Each instance runs `RunEventBus`: one dedicated connection that `LISTEN`s and pushes each announcement to the consoles connected to it. Neon's `-pooler` hosts don't keep LISTEN sessions, so the listener uses the direct host. It reconnects with backoff.
- While the listener isn't connected (tests, no database, a dropped connection), an instance delivers its own events directly, so its consoles never go quiet. The event is still logged, so others catch up on reconnect.
- The SSE stream sends `id:` with every event and starts with `ready`, carrying the stream's position. The browser resends the last id as `Last-Event-ID` when it reconnects; the server subscribes first, then replays up to 500 missed events, skipping duplicates. If the client's last event is no longer in the log (events are kept 24 hours) or the gap is bigger than 500, it sends `resync` and the console refetches everything. A stream too slow to keep up is also told to resync rather than silently dropping events.
- Events stay small signals ("host.changed") and may carry small data; consoles fetch details through the normal API and its permission checks.
- The web proxy forwards the browser's abort to the backend, so a closed tab frees its stream slot at once.

## Consequences

- One extra long-lived database connection per instance.
- Each event costs one insert; the hourly maintenance pass prunes events older than a day.
- Later steps can rely on ordered, resumable delivery: event coverage for every feature, carrying data for hot paths, removing polling, and the agent live channel.

## Step two: every feature live

- `recordAudit` raises a live event for each change people make, mapped by action prefix (`monitor.*` to `monitor.changed`, `domain.*` to `security.changed`, `member.*` to `workspace.changed`, and so on). Every create, update, and delete is live without touching each handler, and new features get it by writing their audit entry.
- `notifyChannels` raises a `notice` event carrying the alert's severity, title, summary, and console path. Every alert worth sending to Slack or email (monitor down or back, certificate expiring, alert rule firing, agent offline, host threshold, security regression, deep scan finished, domain lapsed) also shows as a toast in open consoles, with the same words. Alerts added later get toasts automatically.
- Host metric batches and device polls raise `host.changed` and `device.changed`, so those pages and charts update without polling.
- The console shows notices as toasts (critical ones stay until dismissed, others leave on their own, hovering pauses them) and counts alerts that arrive while the tab is hidden in its title. Replayed notices older than two minutes refresh data without popping up.
- While the stream is live, polling drops to a five-minute safety net. Hosts, agents, and devices keep a one-minute poll because an agent going quiet raises no event.
