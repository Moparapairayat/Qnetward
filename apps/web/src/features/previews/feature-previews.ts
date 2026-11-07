/**
 * UI previews for planned features. Every value here is sample data used to
 * shape the interface before the feature exists; pages render it under a
 * clear "Preview" banner. Replace a feature's preview with a real screen when
 * it ships, and delete its entry here.
 */

export type Tone = "good" | "warn" | "bad" | "info" | "muted";
export type Cell = string | { text: string; tone?: Tone; mono?: boolean };

export type FeaturePreview = {
  slug: string;
  title: string;
  description: string;
  phase: number;
  phaseName: string;
  primaryAction: string;
  stats: { label: string; value: string; hint: string; tone?: Tone }[];
  table?: { title: string; columns: string[]; rows: Cell[][] };
  side?: { title: string; items: { label: string; value: string; tone?: Tone }[] };
  visual?: "topology" | "assistant" | "flows" | "trace" | "timeline" | "schedule";
  capabilities: string[];
};

const g = (text: string): Cell => ({ text, tone: "good" });
const w = (text: string): Cell => ({ text, tone: "warn" });
const b = (text: string): Cell => ({ text, tone: "bad" });
const m = (text: string): Cell => ({ text, tone: "muted" });
const i = (text: string): Cell => ({ text, tone: "info" });
const c = (text: string): Cell => ({ text, mono: true });

export const featurePreviews: FeaturePreview[] = [
  {
    slug: "traceroute",
    title: "Traceroute & MTR",
    description: "Follow the path to a host hop by hop, with loss and latency per hop and alerts when the route changes.",
    phase: 2,
    phaseName: "Agents & monitoring",
    primaryAction: "Run traceroute",
    visual: "trace",
    stats: [
      { label: "Hops", value: "11", hint: "to api.example.com" },
      { label: "End-to-end", value: "184 ms", hint: "median over 10 cycles" },
      { label: "Worst hop loss", value: "6%", hint: "hop 7 · ae2.sgp1", tone: "warn" },
      { label: "Path changes", value: "2", hint: "in the last 24h" },
    ],
    capabilities: [
      "ICMP, UDP, and TCP traceroute",
      "Continuous MTR with per-hop loss and jitter",
      "ASN and location per hop",
      "Alert when the path changes",
    ],
  },
  {
    slug: "agents",
    title: "Probe agents",
    description: "A small outbound-only agent you install on a VPS, Raspberry Pi, or Kubernetes cluster to probe from inside private networks.",
    phase: 2,
    phaseName: "Agents & monitoring",
    primaryAction: "Enroll an agent",
    stats: [
      { label: "Agents", value: "6", hint: "4 online", tone: "good" },
      { label: "Regions", value: "4", hint: "SG · DAC · FRA · VA" },
      { label: "Checks / min", value: "1,240", hint: "across all agents" },
      { label: "Out of date", value: "1", hint: "auto-update pending", tone: "warn" },
    ],
    table: {
      title: "Enrolled agents",
      columns: ["Agent", "Location", "Version", "Platform", "Status", "Last seen"],
      rows: [
        ["sg-edge-01", "Singapore", c("0.4.2"), "linux/amd64", g("Online"), "8s ago"],
        ["dhaka-office", "Dhaka", c("0.4.2"), "linux/arm64 · Pi", g("Online"), "3s ago"],
        ["fra-dc-02", "Frankfurt", c("0.4.1"), "docker", w("Update pending"), "12s ago"],
        ["va-k8s", "Virginia", c("0.4.2"), "kubernetes", g("Online"), "5s ago"],
        ["branch-ctg", "Chattogram", c("0.4.2"), "windows", m("Offline"), "2h ago"],
      ],
    },
    capabilities: [
      "Single static binary, outbound-only over mTLS",
      "One-time enrollment tokens, per-agent certificates",
      "Signed auto-updates with rollback",
      "Local buffering when the link drops",
    ],
  },
  {
    slug: "incidents",
    title: "Incidents",
    description: "One place for an outage: the alerts that triggered it, who's on it, the timeline, and the postmortem afterwards.",
    phase: 5,
    phaseName: "Automation & AI",
    primaryAction: "Declare incident",
    visual: "timeline",
    stats: [
      { label: "Open", value: "1", hint: "SEV-2 · mail delivery", tone: "bad" },
      { label: "MTTA", value: "3m 40s", hint: "last 30 days" },
      { label: "MTTR", value: "41m", hint: "last 30 days" },
      { label: "Postmortems due", value: "1", hint: "from last week", tone: "warn" },
    ],
    table: {
      title: "Recent incidents",
      columns: ["Incident", "Severity", "Started", "Duration", "Owner", "State"],
      rows: [
        ["Mail MX unreachable from FRA", b("SEV-2"), "12m ago", "12m", "Tanvir", b("Investigating")],
        ["Checkout latency spike", w("SEV-3"), "Oct 28", "26m", "Ayesha", g("Resolved")],
        ["DNS propagation delay", w("SEV-3"), "Oct 22", "1h 08m", "Mitu", g("Resolved")],
      ],
    },
    capabilities: ["Alert grouping into incidents", "Dependency-aware suppression", "Timeline, roles, and status updates", "Postmortem templates"],
  },
  {
    slug: "on-call",
    title: "On-call",
    description: "Rotations and escalation policies so the right person gets paged, and the next one does if nobody answers.",
    phase: 5,
    phaseName: "Automation & AI",
    primaryAction: "New schedule",
    visual: "schedule",
    stats: [
      { label: "On call now", value: "Tanvir K.", hint: "until Mon 09:00" },
      { label: "Schedules", value: "3", hint: "NOC, Platform, Security" },
      { label: "Pages this week", value: "7", hint: "2 after hours" },
      { label: "Ack rate", value: "100%", hint: "within 5 minutes", tone: "good" },
    ],
    capabilities: [
      "Daily, weekly, and follow-the-sun rotations",
      "Multi-step escalation policies",
      "Overrides and handoff notes",
      "SMS, voice, push, and chat paging",
    ],
  },
  {
    slug: "automations",
    title: "Automations",
    description: "Runbooks that fire on an alert: call a webhook, run a script on an agent, open a ticket, or post to a channel.",
    phase: 5,
    phaseName: "Automation & AI",
    primaryAction: "New automation",
    stats: [
      { label: "Automations", value: "5", hint: "4 enabled" },
      { label: "Runs (7d)", value: "38", hint: "36 succeeded", tone: "good" },
      { label: "Time saved", value: "≈ 3h", hint: "estimated, last 7 days" },
      { label: "Failed runs", value: "2", hint: "webhook timeout", tone: "warn" },
    ],
    table: {
      title: "Automations",
      columns: ["Name", "Trigger", "Action", "Last run", "Result"],
      rows: [
        ["Restart edge proxy", "Edge SGP down 3×", "Agent script", "2d ago", g("Succeeded")],
        ["Open Jira ticket", "Any SEV-2", "Jira issue", "12m ago", g("Succeeded")],
        ["Flush DNS cache", "DNS mismatch", "Webhook", "5d ago", w("Timed out")],
      ],
    },
    capabilities: [
      "Triggers on alerts, incidents, or schedules",
      "Webhook, script, ticket, and chat actions",
      "Approval steps for risky actions",
      "Full run history",
    ],
  },
  {
    slug: "hosts",
    title: "Hosts",
    description: "CPU, memory, disk, processes, and containers from a host agent on Linux, Windows, and macOS.",
    phase: 3,
    phaseName: "Infrastructure & devices",
    primaryAction: "Install host agent",
    stats: [
      { label: "Hosts", value: "42", hint: "38 reporting", tone: "good" },
      { label: "Avg CPU", value: "37%", hint: "last hour" },
      { label: "Memory pressure", value: "3", hint: "hosts above 85%", tone: "warn" },
      { label: "Disks filling", value: "1", hint: "full in ~6 days", tone: "bad" },
    ],
    table: {
      title: "Hosts",
      columns: ["Host", "OS", "CPU", "Memory", "Disk", "Status"],
      rows: [
        ["api-prod-01", "Ubuntu 24.04", c("32%"), c("61%"), c("61%"), g("Healthy")],
        ["db-master-01", "Debian 12", c("88%"), c("92%"), c("78%"), b("Critical")],
        ["gateway-eu-02", "Ubuntu 22.04", c("55%"), c("73%"), c("81%"), w("Warning")],
        ["scheduler-ap-03", "Windows Server 2022", c("27%"), c("55%"), c("55%"), g("Healthy")],
      ],
    },
    capabilities: [
      "System, process, and container metrics",
      "Kubernetes DaemonSet",
      "Service checks for databases, Redis, nginx, and more",
      "Capacity forecasting",
    ],
  },
  {
    slug: "devices",
    title: "Network devices",
    description: "Switches, routers, firewalls, wireless, servers' BMCs, and UPSes through SNMP, gNMI, Redfish, and vendor APIs.",
    phase: 3,
    phaseName: "Infrastructure & devices",
    primaryAction: "Add device",
    stats: [
      { label: "Devices", value: "128", hint: "via 3 collectors" },
      { label: "Interfaces down", value: "4", hint: "2 unexpected", tone: "warn" },
      { label: "Config changes", value: "6", hint: "in the last 24h" },
      { label: "Optics warning", value: "2", hint: "low RX power", tone: "warn" },
    ],
    table: {
      title: "Devices",
      columns: ["Device", "Vendor", "Model", "Method", "Uptime", "Status"],
      rows: [
        ["core-sw-01", "Cisco", "C9500-24Y4C", "gNMI", "182d", g("Healthy")],
        ["edge-rtr-dac", "MikroTik", "CCR2116", "SNMPv3", "41d", g("Healthy")],
        ["fw-hq", "Fortinet", "FG-100F", "API + syslog", "12d", w("High sessions")],
        ["idrac-db01", "Dell", "R750 iDRAC9", "Redfish", "96d", b("PSU 2 failed")],
        ["ups-rack-a", "APC", "SMT3000", "SNMP", "220d", g("On mains")],
      ],
    },
    capabilities: [
      "Auto-discovery by sysObjectID and LLDP",
      "Interface errors, optics, PoE, BGP/OSPF neighbours",
      "Config backup and diff",
      "YAML profiles for new vendors",
    ],
  },
  {
    slug: "topology",
    title: "Topology",
    description: "A live map of how devices connect, built automatically from LLDP and CDP, with health on every link.",
    phase: 3,
    phaseName: "Infrastructure & devices",
    primaryAction: "Run discovery",
    visual: "topology",
    stats: [
      { label: "Nodes", value: "64", hint: "switches, routers, servers" },
      { label: "Links", value: "112", hint: "from LLDP/CDP" },
      { label: "Degraded links", value: "3", hint: "errors or flaps", tone: "warn" },
      { label: "Last discovery", value: "6m ago", hint: "every 15 minutes" },
    ],
    capabilities: [
      "Automatic layer-2/3 topology",
      "Port-to-server mapping",
      "Link utilisation and errors on the map",
      "Blast-radius view for alerts",
    ],
  },
  {
    slug: "flows",
    title: "Traffic flows",
    description: "Who is talking to whom and how much, from NetFlow, sFlow, and IPFIX.",
    phase: 3,
    phaseName: "Infrastructure & devices",
    primaryAction: "Add flow exporter",
    visual: "flows",
    stats: [
      { label: "Throughput", value: "1.9 Gbps", hint: "current, all exporters" },
      { label: "Flows / sec", value: "18.4k", hint: "sampled 1:1000" },
      { label: "Top app", value: "HTTPS", hint: "61% of bytes" },
      { label: "Anomalies", value: "1", hint: "unusual egress to new ASN", tone: "warn" },
    ],
    capabilities: [
      "Top talkers, apps, and conversations",
      "Per-interface and per-site breakdowns",
      "ASN and country enrichment",
      "Egress anomaly detection",
    ],
  },
  {
    slug: "logs",
    title: "Logs & events",
    description: "Syslog and SNMP traps from your devices, searchable and linked to the alerts and incidents they explain.",
    phase: 3,
    phaseName: "Infrastructure & devices",
    primaryAction: "Add log source",
    stats: [
      { label: "Events / min", value: "2,310", hint: "from 96 sources" },
      { label: "Errors (1h)", value: "41", hint: "mostly fw-hq", tone: "warn" },
      { label: "Retention", value: "30 days", hint: "hot storage" },
      { label: "Saved searches", value: "7", hint: "3 with alerts" },
    ],
    table: {
      title: "Live tail",
      columns: ["Time", "Source", "Severity", "Message"],
      rows: [
        [c("20:41:07"), "fw-hq", w("warning"), "Session table 82% full"],
        [c("20:40:55"), "core-sw-01", m("info"), "Interface Te1/0/12 changed state to up"],
        [c("20:40:31"), "edge-rtr-dac", b("error"), "BGP neighbor 103.x.x.1 Down: hold timer expired"],
        [c("20:39:58"), "idrac-db01", b("critical"), "Power supply 2 input lost"],
      ],
    },
    capabilities: [
      "Syslog and SNMP trap receiver on the collector",
      "Full-text search with saved queries",
      "Alerts on log patterns",
      "Correlation with incidents",
    ],
  },
  {
    slug: "cloud",
    title: "Cloud & Kubernetes",
    description: "Read-only connectors that inventory AWS, GCP, Azure, and Kubernetes resources and pull their health metrics.",
    phase: 3,
    phaseName: "Infrastructure & devices",
    primaryAction: "Connect a cloud account",
    stats: [
      { label: "Accounts", value: "3", hint: "AWS, GCP" },
      { label: "Resources", value: "412", hint: "instances, LBs, buckets" },
      { label: "Clusters", value: "2", hint: "EKS, GKE" },
      { label: "Public exposure", value: "5", hint: "resources reachable from internet", tone: "warn" },
    ],
    capabilities: [
      "Read-only IAM role, nothing to install",
      "Instances, load balancers, databases, buckets",
      "Kubernetes nodes, pods, and services",
      "Exposure feeds into the attack surface view",
    ],
  },
  {
    slug: "assets",
    title: "Assets",
    description: "The domains, IPs, and cloud accounts you've proven you own. Active security scans only run against verified assets.",
    phase: 4,
    phaseName: "Security scanning",
    primaryAction: "Verify an asset",
    stats: [
      { label: "Verified", value: "8", hint: "domains and IP ranges", tone: "good" },
      { label: "Pending", value: "2", hint: "waiting for DNS TXT", tone: "warn" },
      { label: "Discovered", value: "37", hint: "related but unverified" },
      { label: "Scan tier", value: "Tier 1", hint: "safe active scans allowed" },
    ],
    table: {
      title: "Assets",
      columns: ["Asset", "Type", "Verification", "Tier", "Added"],
      rows: [
        ["example.com", "Domain", g("DNS TXT verified"), "Tier 1", "Oct 2"],
        ["203.0.113.0/27", "IP range", g("HTTP token verified"), "Tier 1", "Oct 5"],
        ["shop.example.com", "Subdomain", g("Inherited"), "Tier 1", "Oct 5"],
        ["example.net", "Domain", w("Waiting for TXT record"), m("Tier 0"), "Today"],
      ],
    },
    capabilities: [
      "Ownership by DNS TXT, HTTP token, or cloud role",
      "Tier 0 passive, Tier 1 safe active, Tier 2 deep",
      "Scope allowlists and per-target kill switch",
      "Every scan recorded in the audit log",
    ],
  },
  {
    slug: "attack-surface",
    title: "Attack surface",
    description: "Everything of yours that's reachable from the internet: subdomains, open services, certificates, and exposed storage.",
    phase: 4,
    phaseName: "Security scanning",
    primaryAction: "Run discovery",
    stats: [
      { label: "Subdomains", value: "146", hint: "12 new this week", tone: "warn" },
      { label: "Open services", value: "58", hint: "on 31 hosts" },
      { label: "Expiring certs", value: "3", hint: "within 14 days", tone: "warn" },
      { label: "Takeover risk", value: "1", hint: "dangling CNAME", tone: "bad" },
    ],
    table: {
      title: "New exposure",
      columns: ["Host", "Finding", "Port", "First seen", "Risk"],
      rows: [
        ["staging.example.com", "Admin panel exposed", c("8443"), "2h ago", b("High")],
        ["old-blog.example.com", "CNAME to unclaimed bucket", c("—"), "1d ago", b("High")],
        ["vpn.example.com", "TLS 1.0 enabled", c("443"), "3d ago", w("Medium")],
        ["mail.example.com", "DMARC policy p=none", c("—"), "5d ago", w("Medium")],
      ],
    },
    capabilities: [
      "Subdomain discovery from CT logs, DNS, and ASN",
      "Service and technology fingerprinting",
      "TLS, SPF/DKIM/DMARC, and takeover checks",
      "Alerts on anything new",
    ],
  },
  {
    slug: "vulnerabilities",
    title: "Vulnerabilities",
    description: "Findings from safe, non-intrusive checks, ranked by what's actually likely to be exploited.",
    phase: 4,
    phaseName: "Security scanning",
    primaryAction: "Scan verified assets",
    stats: [
      { label: "Open findings", value: "23", hint: "on 11 assets" },
      { label: "Critical", value: "2", hint: "both in CISA KEV", tone: "bad" },
      { label: "High EPSS", value: "4", hint: "> 10% exploit probability", tone: "warn" },
      { label: "Fixed (30d)", value: "17", hint: "verified by rescan", tone: "good" },
    ],
    table: {
      title: "Findings",
      columns: ["CVE", "Asset", "CVSS", "EPSS", "KEV", "Status"],
      rows: [
        [c("CVE-2024-3400"), "fw-hq", b("10.0"), c("94%"), b("Yes"), b("Open")],
        [c("CVE-2023-4966"), "vpn.example.com", b("9.4"), c("96%"), b("Yes"), w("In progress")],
        [c("CVE-2024-6387"), "api-prod-01", w("8.1"), c("18%"), m("No"), b("Open")],
        [c("CVE-2023-44487"), "edge-lb", w("7.5"), c("72%"), b("Yes"), g("Fixed")],
      ],
    },
    capabilities: [
      "Version detection plus active verification",
      "CVSS, EPSS, and CISA KEV ranking",
      "Authenticated scans via agent (Tier 2)",
      "Fix guidance and retesting",
    ],
  },
  {
    slug: "scans",
    title: "Scans",
    description: "Schedule and review security scans. Each one is scoped to verified assets, rate-limited, and logged.",
    phase: 4,
    phaseName: "Security scanning",
    primaryAction: "New scan",
    stats: [
      { label: "Scheduled", value: "4", hint: "weekly and daily" },
      { label: "Running", value: "1", hint: "attack surface · 62%", tone: "info" },
      { label: "Completed (30d)", value: "29", hint: "no aborts" },
      { label: "Tier", value: "1", hint: "Tier 2 needs signed consent" },
    ],
    table: {
      title: "Scan history",
      columns: ["Scan", "Scope", "Tier", "Started", "Duration", "Result"],
      rows: [
        ["Weekly external", "8 assets", "Tier 1", "Running", c("14m"), i("62%")],
        ["TLS & mail", "example.com", "Tier 1", "Today 06:00", c("4m"), g("2 findings")],
        ["Passive discovery", "All domains", "Tier 0", "Today 03:00", c("9m"), g("12 new hosts")],
      ],
    },
    capabilities: [
      "Tiered permissions with ownership checks",
      "Scope, schedule, and rate limits per scan",
      "Sandboxed scanners on a dedicated egress pool",
      "Kill switch per target",
    ],
  },
  {
    slug: "compliance",
    title: "Compliance",
    description: "Map checks and evidence to CIS, PCI DSS, ISO 27001, and SOC 2, and export reports for auditors.",
    phase: 4,
    phaseName: "Security scanning",
    primaryAction: "Add framework",
    stats: [
      { label: "Frameworks", value: "2", hint: "CIS, SOC 2" },
      { label: "Controls passing", value: "84%", hint: "126 of 150", tone: "good" },
      { label: "Failing", value: "9", hint: "5 high priority", tone: "bad" },
      { label: "Evidence", value: "212", hint: "collected automatically" },
    ],
    side: {
      title: "Frameworks",
      items: [
        { label: "CIS Controls v8", value: "88%", tone: "good" },
        { label: "SOC 2 Type II", value: "79%", tone: "warn" },
        { label: "ISO 27001", value: "Not started", tone: "muted" },
        { label: "PCI DSS 4.0", value: "Not started", tone: "muted" },
      ],
    },
    capabilities: [
      "Control mapping from scan and monitor results",
      "Automatic evidence collection",
      "Jira tickets for failing controls",
      "Auditor-ready exports",
    ],
  },
  {
    slug: "assistant",
    title: "AI assistant",
    description: "Ask about your network in plain language, get likely root causes for alert storms, and draft incident summaries.",
    phase: 5,
    phaseName: "Automation & AI",
    primaryAction: "Ask a question",
    visual: "assistant",
    stats: [
      { label: "Answers", value: "Grounded", hint: "cites your own data" },
      { label: "Root-cause hints", value: "Per incident", hint: "groups related alerts" },
      { label: "Data residency", value: "Your tenant", hint: "self-hosted model option" },
      { label: "Forecasts", value: "Disk, bandwidth", hint: "capacity predictions" },
    ],
    capabilities: [
      "Natural-language questions over metrics and history",
      "Alert grouping and likely root cause",
      "Incident summaries and fix suggestions",
      "Anomaly detection with learned baselines",
    ],
  },
  {
    slug: "sso",
    title: "SSO & SCIM",
    description: "Sign in through your identity provider and keep membership in sync automatically.",
    phase: 6,
    phaseName: "Enterprise",
    primaryAction: "Configure SSO",
    stats: [
      { label: "Protocol", value: "SAML / OIDC", hint: "Okta, Entra ID, Google" },
      { label: "Provisioning", value: "SCIM 2.0", hint: "users and groups" },
      { label: "Enforcement", value: "Optional", hint: "require SSO for all members" },
      { label: "MFA", value: "TOTP, passkeys", hint: "for non-SSO accounts" },
    ],
    capabilities: [
      "SAML 2.0 and OpenID Connect",
      "SCIM user and group provisioning",
      "Role mapping from IdP groups",
      "Enforced SSO with break-glass accounts",
    ],
  },
];

export const previewBySlug = new Map(featurePreviews.map((f) => [f.slug, f]));
