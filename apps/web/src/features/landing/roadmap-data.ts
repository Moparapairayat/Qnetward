/**
 * The public roadmap, shown on /roadmap. Keep it at feature level: no dates
 * and no internal technology choices. Phases follow the order the work
 * actually happens in; mark an item "shipped" only once it works in the
 * console.
 */

export type ItemStatus = "shipped" | "building" | "planned";
export type PhaseStatus = "shipped" | "building" | "next" | "later";

export type RoadmapItem = { name: string; status: ItemStatus };

export type RoadmapPhase = {
  number: number;
  name: string;
  summary: string;
  status: PhaseStatus;
  items: RoadmapItem[];
};

export const phaseStatusLabel: Record<PhaseStatus, string> = {
  shipped: "Shipped",
  building: "Building",
  next: "Next",
  later: "Later",
};

export const itemStatusLabel: Record<ItemStatus, string> = {
  shipped: "In the console today",
  building: "Being built now",
  planned: "Planned",
};

export const roadmap: RoadmapPhase[] = [
  {
    number: 1,
    name: "Diagnose",
    summary: "Find out what's wrong, right now, from a browser tab.",
    status: "shipped",
    items: [
      { name: "Ping and TCP ping", status: "shipped" },
      { name: "Port scan", status: "shipped" },
      { name: "DNS lookup and traceroute", status: "shipped" },
      { name: "History and CSV / JSON export", status: "shipped" },
      { name: "Workspaces, roles, audit log", status: "shipped" },
      { name: "Two-factor sign-in and passkeys", status: "shipped" },
      { name: "API keys and an OpenAPI spec", status: "shipped" },
    ],
  },
  {
    number: 2,
    name: "Monitor everywhere",
    summary: "Know before your users do, from inside your own networks too.",
    status: "shipped",
    items: [
      { name: "Uptime monitors and alert rules", status: "shipped" },
      { name: "Slack, Discord, Telegram, webhook alerts", status: "shipped" },
      { name: "Public status pages", status: "shipped" },
      { name: "Probe agents for private networks", status: "shipped" },
      { name: "Monitors from several locations", status: "shipped" },
      { name: "Live updates across the console", status: "shipped" },
    ],
  },
  {
    number: 3,
    name: "Security scanning",
    summary: "Scan only what you're allowed to, and keep a record of it.",
    status: "shipped",
    items: [
      { name: "Passive checks for any domain", status: "shipped" },
      { name: "Domain ownership verification", status: "shipped" },
      { name: "Attack surface discovery", status: "shipped" },
      { name: "Vulnerabilities with risk scores", status: "shipped" },
      { name: "Authorized deep scans", status: "shipped" },
      { name: "Compliance mapping", status: "shipped" },
    ],
  },
  {
    number: 4,
    name: "Infrastructure & devices",
    summary: "See the servers and network gear you already run.",
    status: "building",
    items: [
      { name: "Host metrics and alerts", status: "shipped" },
      { name: "Network devices over SNMP", status: "shipped" },
      { name: "Device alerts", status: "building" },
      { name: "Live network topology", status: "planned" },
      { name: "Traffic flows", status: "planned" },
      { name: "Logs and cloud accounts", status: "planned" },
    ],
  },
  {
    number: 5,
    name: "Automation & AI",
    summary: "Fewer alerts, faster answers.",
    status: "next",
    items: [
      { name: "Incidents that group related alerts", status: "planned" },
      { name: "On-call schedules and paging", status: "planned" },
      { name: "Automations on alerts", status: "planned" },
      { name: "An assistant that suggests the cause", status: "planned" },
    ],
  },
  {
    number: 6,
    name: "Developer platform",
    summary: "Build on Qnetward from your own code.",
    status: "later",
    items: [
      { name: "Versioned public API", status: "planned" },
      { name: "SDKs for TypeScript, Python, Go", status: "planned" },
      { name: "Terraform provider", status: "planned" },
    ],
  },
  {
    number: 7,
    name: "Enterprise",
    summary: "Run it your organization's way.",
    status: "later",
    items: [
      { name: "SSO (SAML, OIDC) and SCIM", status: "planned" },
      { name: "Dedicated or self-hosted", status: "planned" },
      { name: "Audit export and data residency", status: "planned" },
      { name: "Priority support and an SLA", status: "planned" },
    ],
  },
];
