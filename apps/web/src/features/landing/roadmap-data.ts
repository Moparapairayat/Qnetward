/**
 * The public roadmap, shared by the landing preview and /roadmap. Keep it at
 * feature level: no dates, no internal technology choices. Move an item to
 * "now" only when it ships in the console.
 */

export type Horizon = "now" | "next" | "later";

export type RoadmapItem = {
  name: string;
  body: string;
  horizon: Horizon;
};

export type RoadmapTheme = {
  id: string;
  name: string;
  summary: string;
  items: RoadmapItem[];
};

export const horizonMeta: Record<Horizon, { label: string; caption: string }> = {
  now: { label: "Now", caption: "In the console today" },
  next: { label: "Next", caption: "What we're building toward" },
  later: { label: "Later", caption: "Planned, order may change" },
};

export const roadmap: RoadmapTheme[] = [
  {
    id: "diagnose",
    name: "Diagnose",
    summary: "Find out what's wrong, right now, from a browser tab.",
    items: [
      { name: "Ping and TCP ping", body: "Streamed replies with a live latency chart, loss, and jitter.", horizon: "now" },
      { name: "Port scan", body: "Up to 4,096 ports per run, with service names and handshake times.", horizon: "now" },
      { name: "DNS lookup", body: "Every record type, any resolver, with DNSSEC and mail checks.", horizon: "now" },
      { name: "Traceroute", body: "Hop-by-hop paths with latency per hop.", horizon: "next" },
    ],
  },
  {
    id: "monitor",
    name: "Monitor",
    summary: "Know before your users do.",
    items: [
      { name: "Alert rules", body: "Latency and loss thresholds with cooldowns, delivered by email.", horizon: "now" },
      { name: "History and export", body: "Stored results you can chart, filter, and export as CSV or JSON.", horizon: "now" },
      { name: "Uptime monitors", body: "HTTP(S), TCP, and ping checks every 30 seconds to every hour, with an email when a target goes down and when it's back.", horizon: "now" },
      { name: "Certificate expiry", body: "HTTPS monitors warn you two weeks before a certificate runs out.", horizon: "now" },
      { name: "Chat and webhook alerts", body: "Send monitor, certificate, and alert rule alerts to Slack, Discord, Telegram, or your own signed webhook.", horizon: "now" },
      { name: "Status pages", body: "A public page your customers can check during an incident.", horizon: "next" },
      { name: "Incidents and on-call", body: "Group related alerts into one incident and page whoever is on call.", horizon: "later" },
    ],
  },
  {
    id: "reach",
    name: "Reach every network",
    summary: "See inside private networks and the gear you already run.",
    items: [
      { name: "Probe agents", body: "An outbound-only agent for private networks and remote sites.", horizon: "next" },
      { name: "Device collector", body: "SNMP, gNMI, Redfish, and syslog from routers, switches, and servers.", horizon: "later" },
      { name: "Topology", body: "A live map of your network built from neighbour discovery.", horizon: "later" },
    ],
  },
  {
    id: "secure",
    name: "Secure",
    summary: "Scan only what you're allowed to, and keep a record of it.",
    items: [
      { name: "Passive checks", body: "Certificates, DNS, and HTTP headers from public signals only.", horizon: "next" },
      { name: "Attack surface", body: "Discovery of subdomains, open services, and certificates on domains you've verified.", horizon: "later" },
      { name: "Deep scans", body: "Authorized, intrusive checks with signed consent and manual approval.", horizon: "later" },
    ],
  },
  {
    id: "team",
    name: "Team and platform",
    summary: "Run it with your team, your way.",
    items: [
      { name: "Workspaces and roles", body: "Invitations, owner, admin, member, and viewer roles, and workspace switching.", horizon: "now" },
      { name: "Account security", body: "Two-factor sign-in with recovery codes, password changes, sessions, and account deletion.", horizon: "now" },
      { name: "Audit log", body: "An append-only record of sign-ins, member changes, monitors, scans, and exports.", horizon: "now" },
      { name: "API keys", body: "Scoped workspace keys for scripts, CI, and Terraform, with an OpenAPI spec.", horizon: "now" },
      { name: "SSO and SCIM", body: "Enterprise sign-in and user provisioning.", horizon: "later" },
      { name: "Root-cause hints", body: "Point at the most likely cause when a storm of alerts arrives.", horizon: "later" },
    ],
  },
];

export const itemsByHorizon = (horizon: Horizon) => roadmap.flatMap((theme) => theme.items.filter((item) => item.horizon === horizon));
