# 31. Network devices are polled over SNMP by agents

## Status

Accepted. Second step of the Infrastructure phase.

## Context

Routers, switches, and firewalls sit on private networks the server can't reach, and they can't run our agent. Nearly all of them speak SNMP. We already have an outbound-only agent inside customers' networks.

## Decision

- A workspace adds a device with its address, port, SNMP version (v2c or v3), credentials, poll interval (30 seconds to 1 hour), and the agent that polls it.
- Credentials (community, or SNMPv3 user, auth and privacy protocols and passphrases) are validated, sealed with the server's encryption key, never returned to the console, and sent only to the assigned agent in its heartbeat reply. Changing the address, version, agent, or credentials resets the device's state.
- The agent (0.3.0) polls with gosnmp: the system group (`1.3.6.1.2.1.1`) with Get, then `ifTable` and `ifXTable` with GetBulk. It prefers 64-bit counters, handles 32-bit wraps, and reports per-interface bits per second, errors, and discards from the second poll on. It reports at most 512 interfaces and keeps up to 500 unsent polls.
- `POST /api/agent/devices` accepts polls only for devices assigned to the calling agent. Each poll updates the device (status up or down, last error, system info, interfaces) and adds a total row to `device_metrics` and a row per interface to `device_if_metrics` (migration 0033, RLS, 7-day retention). A late poll adds history but doesn't change the current state.
- Only owners and admins manage devices; the demo account can't. Plans allow 5, 100, or 1000 devices.
- `internal/platform/snmpfake` is a small SNMPv2c responder that tests and demos use as a switch.

## Consequences

- No inbound access to customer networks, and one agent covers checks, host metrics, and devices.
- Alerts for unreachable devices and interfaces going down come next.
- Vendor-specific MIBs (CPU, temperature, power supplies) and LLDP-based topology are not read yet.
