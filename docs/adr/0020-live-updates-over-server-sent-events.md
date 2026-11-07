# 20. Live updates over Server-Sent Events

## Status

Accepted.

## Context

The console polled: the overview every 5 seconds, monitors and alert rules
every 15 to 20. Changes showed up late, and an idle tab kept the API busy.
The only real-time channel was the probe WebSocket, which is per run.

## Decision

- `GET /api/events` is a Server-Sent Events stream for the active workspace.
  It carries small notices, such as `monitor.check` with the monitor ID and
  status, or `alert.changed`, never the data itself. The console refetches
  through the normal API, so permissions and shapes stay in one place.
- A hub in the API process fans events out per workspace, with a bounded
  buffer per stream (a slow stream drops events; its next refetch catches
  up), a cap of 50 streams per workspace, and a heartbeat every 25 seconds so
  proxies keep the connection open. `X-Accel-Buffering: no` asks proxies not
  to buffer it.
- The console opens one `EventSource`, folds bursts into one refetch, and
  slows its polling to once a minute while the stream is connected. If the
  stream drops, polling returns to its old pace until the browser reconnects.

## Consequences

- With several API instances, an event raised on one instance only reaches
  browsers connected to it; the others catch up at the slower poll. Postgres
  `LISTEN/NOTIFY` or Redis pub/sub can carry events between instances later,
  though `LISTEN` doesn't work through a transaction-mode pooler.
