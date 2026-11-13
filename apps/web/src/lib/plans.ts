import type { Plan, PlanLimits, PlanPrice, PublicPlansResponse } from "@/lib/types";

/**
 * Plans and prices as the site shows them. Every number comes from the server
 * (GET /api/plans), the same catalog it enforces and the same prices checkout
 * charges, so the landing page and the billing page can't drift from it.
 */

export type PlanId = Plan["id"];

/** Plan names as customers know them; older rows say "starter" for Free. */
export function planLabel(plan?: string | null) {
  const id = (plan ?? "").toLowerCase();
  return id === "pro" ? "Pro" : id === "enterprise" ? "Enterprise" : "Free";
}
export type Period = "monthly" | "yearly";

// "BDT" rather than ৳: the site font has no taka sign, and a fallback glyph looks broken.
export const taka = (amount: number) => `BDT ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const count = (n: number) => n.toLocaleString("en-US");

/** What one period of a plan costs, in the words the pricing cards use. */
export type PeriodPrice = {
  /** Amount per month for this period, e.g. 1,250 for a year at 15,000. */
  perMonth: number;
  /** What is paid at checkout for the whole period. */
  total: number;
  months: number;
};

/**
 * The money behind the monthly / yearly switch. Yearly is the yearly price
 * spread over twelve months (shown to the paisa, never rounded in its favour),
 * and the saving is twelve monthly payments minus one yearly one.
 */
export function proPricing(prices: PlanPrice[]) {
  const monthly = prices.find((p) => p.months === 1);
  const yearly = prices.find((p) => p.months === 12);
  const toPeriod = (p?: PlanPrice): PeriodPrice | undefined =>
    p ? { perMonth: Math.floor((p.amount / p.months) * 100) / 100, total: p.amount, months: p.months } : undefined;
  const fullYear = monthly ? monthly.amount * 12 : 0;
  const saving = monthly && yearly ? Math.max(0, fullYear - yearly.amount) : 0;
  return {
    monthly: toPeriod(monthly),
    yearly: toPeriod(yearly),
    /** Taka saved by paying for a year at once instead of month by month. */
    saving,
    /** The saving as a share of twelve monthly payments, rounded down. */
    savingPercent: saving > 0 ? Math.floor((saving / fullYear) * 100) : 0,
    /** The saving in months of Pro, when it's a whole number ("2 months free"). */
    freeMonths: saving > 0 && monthly && Number.isInteger(saving / monthly.amount) ? saving / monthly.amount : 0,
  };
}

export type PlanCopy = {
  audience: string;
  inherits?: string;
  /** The three headline limits shown on each card. */
  headline: [string, string][];
  features: { label: string; planned?: boolean }[];
};

/** Card copy for a plan, written from its limits so it always says what the server allows. */
export function planCopy(id: PlanId, l: PlanLimits): PlanCopy {
  const headline: [string, string][] = [
    ["Monitors", count(l.monitors)],
    ["Members", count(l.members)],
    ["Probe agents", count(l.agents)],
  ];
  if (id === "free") {
    return {
      audience: "Everything you need to start monitoring, for you and your team.",
      headline,
      features: [
        { label: "Ping, TCP ping, port scan, DNS lookup, and traceroute" },
        { label: `HTTP(S), TCP, and ping monitors, each from up to ${count(l.monitor_locations)} locations` },
        { label: `${count(l.status_pages)} public status page` },
        { label: `Host metrics and ${count(l.devices)} SNMP devices` },
        { label: "Alerts by email, Slack, Discord, Telegram, or webhook" },
        { label: "Workspaces, roles, API keys, audit log" },
      ],
    };
  }
  if (id === "pro") {
    return {
      audience: "For teams that rely on Qnetward every day and need room to grow.",
      inherits: "Everything in Free, plus",
      headline,
      features: [
        { label: `${count(l.status_pages)} status pages and ${count(l.devices)} SNMP devices` },
        { label: `Monitors from up to ${count(l.monitor_locations)} locations each` },
        { label: `${count(l.deep_scans_per_month)} authorized deep security scans a month` },
        { label: `${count(l.watched_domains)} domains watched for certificate and DNS changes` },
        { label: "Priority email support" },
      ],
    };
  }
  return {
    audience: "For ISPs, MSPs, and regulated teams with their own requirements.",
    inherits: "Everything in Pro, plus",
    headline,
    features: [
      { label: `${count(l.deep_scans_per_month)} deep security scans a month` },
      { label: `${count(l.status_pages)} status pages and ${count(l.devices)} SNMP devices` },
      { label: "SSO (SAML, OIDC) and SCIM", planned: true },
      { label: "Dedicated or self-hosted deployment", planned: true },
      { label: "Priority support and an SLA", planned: true },
    ],
  };
}

export type Cell = true | false | "planned" | string;

/** The full comparison table, built from each plan's limits. */
export function comparisonRows(catalog: PublicPlansResponse): { group: string; rows: { label: string; values: Cell[] }[] }[] {
  const plans = catalog.plans;
  const each = (pick: (l: PlanLimits) => number, suffix = "") => plans.map((p) => (pick(p.limits) > 0 ? `${count(pick(p.limits))}${suffix}` : false) as Cell);
  const all = (value: Cell) => plans.map(() => value);
  return [
    {
      group: "Monitoring",
      rows: [
        { label: "Uptime monitors", values: each((l) => l.monitors) },
        { label: "Locations per monitor", values: each((l) => l.monitor_locations) },
        { label: "Probe agents", values: each((l) => l.agents) },
        { label: "Public status pages", values: each((l) => l.status_pages) },
        { label: "Email, chat, and webhook alerts", values: all(true) },
        { label: "Probe history", values: all(`${catalog.history_days} days`) },
      ],
    },
    {
      group: "Infrastructure",
      rows: [
        { label: "Host metrics", values: all(true) },
        { label: "Host alert rules", values: each((l) => l.host_alert_rules) },
        { label: "SNMP devices", values: each((l) => l.devices) },
      ],
    },
    {
      group: "Security",
      rows: [
        { label: "Verified domains", values: each((l) => l.verified_domains) },
        { label: "Watched domains", values: each((l) => l.watched_domains) },
        { label: "Attack surface scans", values: each((l) => l.surface_scans_per_hour, " / hr") },
        { label: "Deep security scans", values: each((l) => l.deep_scans_per_month, " / month") },
      ],
    },
    {
      group: "Usage",
      rows: [
        { label: "Probes", values: each((l) => l.probes_per_hour, " / hr") },
        { label: "Port scans", values: each((l) => l.scans_per_hour, " / hr") },
        { label: "API requests", values: each((l) => l.api_requests_per_minute, " / min") },
        { label: "API keys", values: each((l) => l.api_keys) },
      ],
    },
    {
      group: "Team",
      rows: [
        { label: "Members", values: each((l) => l.members) },
        { label: "Workspaces and roles", values: all(true) },
        { label: "SSO and SCIM", values: plans.map((p) => (p.id === "enterprise" ? "planned" : false)) },
      ],
    },
  ];
}
