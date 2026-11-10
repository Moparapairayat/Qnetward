-- Alerts when a probe agent stops checking in. offline_since is set once the
-- server has sent the "offline" alert, so it goes out once, and is cleared by
-- the agent's next heartbeat, which sends the "back online" alert.
ALTER TABLE probe_agents ADD COLUMN IF NOT EXISTS offline_since TIMESTAMPTZ;

-- Channels that hear about monitors also hear about the agents running them.
UPDATE notification_channels
SET events = array_append(events, 'agents')
WHERE 'monitors' = ANY(events) AND NOT ('agents' = ANY(events));
