import {
  Activity,
  BadgeCheck,
  Bell,
  Bot,
  Boxes,
  Building2,
  Cable,
  CalendarClock,
  ClipboardCheck,
  Cloud,
  CreditCard,
  FileClock,
  Gauge,
  Globe,
  HardDrive,
  History,
  KeyRound,
  LayoutDashboard,
  ListTree,
  Network,
  Plug,
  Radar,
  Radio,
  RadioTower,
  ScanSearch,
  ScrollText,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  Siren,
  Sparkles,
  User,
  Users,
  Waypoints,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  keywords?: string;
  /** Planned feature: the page is a UI preview with sample data. */
  soon?: boolean;
};
export type NavSection = { label: string; items: NavItem[]; adminOnly?: boolean; hiddenInSidebar?: boolean };

/** Single source for the sidebar, the command palette, and page titles. */
export const navSections: NavSection[] = [
  {
    label: "Home",
    items: [{ href: "/overview", label: "Overview", icon: LayoutDashboard, keywords: "home dashboard" }],
  },
  {
    label: "Diagnostics",
    items: [
      { href: "/icmp-ping", label: "ICMP ping", icon: Activity, keywords: "ping latency loss" },
      { href: "/tcp-ping", label: "TCP ping", icon: Zap, keywords: "port handshake connect" },
      { href: "/port-scan", label: "Port scan", icon: Radar, keywords: "ports open services" },
      { href: "/dns-lookup", label: "DNS lookup", icon: Globe, keywords: "records mx txt dnssec" },
      { href: "/traceroute", label: "Traceroute", icon: Waypoints, keywords: "mtr hops path route latency loss" },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { href: "/monitors", label: "Monitors", icon: Radio, keywords: "uptime scheduled checks down" },
      { href: "/agents", label: "Probe agents", icon: RadioTower, keywords: "regions enroll vantage private network" },
      { href: "/status-pages", label: "Status pages", icon: BadgeCheck, keywords: "public uptime sla customers incident" },
      { href: "/history", label: "History", icon: History, keywords: "results export csv" },
      { href: "/alerts", label: "Alert rules", icon: Bell, keywords: "notifications thresholds email" },
    ],
  },
  {
    label: "Incidents",
    items: [
      { href: "/incidents", label: "Incidents", icon: Siren, keywords: "outage timeline postmortem", soon: true },
      { href: "/on-call", label: "On-call", icon: CalendarClock, keywords: "schedule rotation escalation", soon: true },
      { href: "/automations", label: "Automations", icon: Workflow, keywords: "runbooks remediation webhook", soon: true },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { href: "/hosts", label: "Hosts", icon: Server, keywords: "cpu memory disk agent", soon: true },
      { href: "/devices", label: "Devices", icon: HardDrive, keywords: "snmp gnmi redfish switch router", soon: true },
      { href: "/topology", label: "Topology", icon: Network, keywords: "map lldp cdp", soon: true },
      { href: "/flows", label: "Traffic flows", icon: Cable, keywords: "netflow sflow ipfix top talkers", soon: true },
      { href: "/logs", label: "Logs", icon: ScrollText, keywords: "syslog traps events", soon: true },
      { href: "/cloud", label: "Cloud", icon: Cloud, keywords: "aws gcp azure kubernetes inventory", soon: true },
    ],
  },
  {
    label: "Security",
    items: [
      { href: "/assets", label: "Assets", icon: Boxes, keywords: "ownership verification domains", soon: true },
      { href: "/attack-surface", label: "Attack surface", icon: ScanSearch, keywords: "subdomains exposure certificates", soon: true },
      { href: "/vulnerabilities", label: "Vulnerabilities", icon: ShieldAlert, keywords: "cve cvss epss kev", soon: true },
      { href: "/scans", label: "Scans", icon: ListTree, keywords: "tier scope schedule", soon: true },
      { href: "/compliance", label: "Compliance", icon: ClipboardCheck, keywords: "cis pci iso soc2 evidence", soon: true },
    ],
  },
  {
    label: "Intelligence",
    items: [{ href: "/assistant", label: "AI assistant", icon: Sparkles, keywords: "ai ask root cause natural language", soon: true }],
  },
  {
    // Lives in workspace settings; listed here for the palette and page titles.
    label: "Workspace",
    hiddenInSidebar: true,
    items: [
      { href: "/workspace/general", label: "Workspace general", icon: Settings, keywords: "workspace name rename company" },
      { href: "/workspace/team", label: "Team", icon: Users, keywords: "members invite roles" },
      { href: "/workspace/integrations", label: "Integrations", icon: Plug, keywords: "slack telegram discord webhook alerts channels notifications" },
      { href: "/workspace/api-keys", label: "API keys", icon: KeyRound, keywords: "tokens sdk terraform ci automation" },
      { href: "/workspace/audit-log", label: "Audit log", icon: FileClock, keywords: "activity history who what when security" },
      { href: "/workspace/billing", label: "Billing", icon: CreditCard, keywords: "plan subscription usage" },
      { href: "/sso", label: "SSO & SCIM", icon: Bot, keywords: "saml oidc enterprise", soon: true },
      { href: "/status", label: "System status", icon: Settings, keywords: "deployment status runtime database redis storage" },
    ],
  },
  {
    label: "Account",
    hiddenInSidebar: true,
    items: [
      { href: "/settings/profile", label: "Profile", icon: User, keywords: "settings name bio avatar timezone" },
      { href: "/settings/account", label: "Account", icon: User, keywords: "settings email verification" },
      { href: "/settings/notifications", label: "Notifications", icon: User, keywords: "settings alerts email channels" },
      { href: "/settings/security", label: "Password and sessions", icon: Shield, keywords: "settings security password sign out" },
      { href: "/settings/workspaces", label: "Your workspaces", icon: User, keywords: "settings invitations join switch" },
    ],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [
      { href: "/admin", label: "Admin overview", icon: Gauge },
      { href: "/admin/users", label: "Users", icon: User },
      { href: "/admin/workspaces", label: "Workspaces", icon: Building2 },
      { href: "/admin/system", label: "System", icon: Server },
    ],
  },
];

export const sidebarSections = (isAdmin: boolean) => navSections.filter((s) => !s.hiddenInSidebar && (!s.adminOnly || isAdmin));

/** Sections start folded when nothing in them has shipped yet. */
export const sectionOpenByDefault = (section: NavSection) => section.items.some((i) => !i.soon);

/** Pages reached through the sidebar's Settings entry. */
export const isSettingsPath = (pathname: string) =>
  ["/workspace", "/settings", "/integrations", "/sso", "/status"].some((p) => pathname === p || pathname.startsWith(`${p}/`));

export const paletteSections = (isAdmin: boolean) => navSections.filter((s) => !s.adminOnly || isAdmin);

export function findNav(pathname: string) {
  for (const section of navSections) {
    const item = section.items.find((i) => i.href === pathname);
    if (item) return { section: section.label, item };
  }
  return null;
}
