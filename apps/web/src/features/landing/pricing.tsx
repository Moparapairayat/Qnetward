import Link from "next/link";
import { Check, Clock3, Minus } from "lucide-react";

type Feature = { label: string; planned?: boolean };

type Plan = {
  id: "free" | "pro" | "enterprise";
  name: string;
  audience: string;
  price: string;
  priceNote: string;
  inherits?: string;
  features: Feature[];
  cta: { label: string; href: string };
  current?: boolean;
};

const plans: Plan[] = [
  {
    id: "free",
    name: "Free",
    audience: "For you and your team, while Qnetward is in beta.",
    price: "$0",
    priceNote: "No card needed",
    features: [
      { label: "ICMP ping, TCP ping, port scan, DNS lookup" },
      { label: "Live results and 7 days of history" },
      { label: "Up to 20 uptime monitors, HTTP(S), TCP, or ping" },
      { label: "Alerts by email, Slack, Discord, Telegram, or webhook" },
      { label: "Workspaces, invitations, and roles" },
      { label: "CSV and JSON export" },
    ],
    cta: { label: "Start free", href: "/signup" },
    current: true,
  },
  {
    id: "pro",
    name: "Pro",
    audience: "For teams that watch continuously, from more places.",
    price: "BDT 1,500",
    priceNote: "a month, or BDT 15,000 a year. bKash, Nagad, Rocket, or card",
    inherits: "Everything in Free, plus",
    features: [
      { label: "200 monitors, 100 members, 3,000 probes an hour" },
      { label: "Probe agents for private networks", planned: true },
      { label: "Multi-region probing", planned: true },
      { label: "Longer history retention", planned: true },
      { label: "Device collector (SNMP, syslog)", planned: true },
    ],
    cta: { label: "Start free, upgrade anytime", href: "/signup" },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    audience: "For ISPs, MSPs, and regulated teams.",
    price: "Custom",
    priceNote: "Annual agreement",
    inherits: "Everything in Pro, plus",
    features: [
      { label: "SSO (SAML, OIDC) and SCIM", planned: true },
      { label: "Dedicated or self-hosted deployment", planned: true },
      { label: "Authorized deep security scanning", planned: true },
      { label: "Audit log export and data residency", planned: true },
      { label: "Priority support and an SLA", planned: true },
    ],
    cta: { label: "Register interest", href: "/signup" },
  },
];

type Cell = true | false | "planned" | string;

const comparison: { group: string; rows: { label: string; values: [Cell, Cell, Cell] }[] }[] = [
  {
    group: "Diagnostics",
    rows: [
      { label: "Ping, TCP ping, port scan, DNS", values: [true, true, true] },
      { label: "History retention", values: ["7 days", "planned", "planned"] },
      { label: "Export to CSV and JSON", values: [true, true, true] },
    ],
  },
  {
    group: "Monitoring",
    rows: [
      { label: "Alert rules", values: [true, true, true] },
      { label: "Chat and webhook alerts", values: [true, true, true] },
      { label: "Uptime monitors", values: ["20", "200", "2,000"] },
      { label: "Probe agents and regions", values: [false, "planned", "planned"] },
    ],
  },
  {
    group: "Team and security",
    rows: [
      { label: "Workspaces and roles", values: [true, true, true] },
      { label: "SSO and SCIM", values: [false, false, "planned"] },
    ],
  },
];

function CellValue({ value }: { value: Cell }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-[var(--lp-green)]" aria-label="Included" />;
  if (value === false) return <Minus className="mx-auto h-4 w-4 text-[var(--lp-subtle)] opacity-50" aria-label="Not included" />;
  if (value === "planned")
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-[var(--lp-subtle)]">
        <Clock3 className="h-3 w-3" aria-hidden="true" /> Planned
      </span>
    );
  return <span className="text-[13px] text-[var(--lp-text)]">{value}</span>;
}

export function Pricing() {
  return (
    <div className="lp-reveal">
      <div className="grid overflow-hidden rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-bg-raised)] lg:grid-cols-3">
        {plans.map((plan, i) => (
          <article
            key={plan.id}
            className={`relative flex flex-col p-7 sm:p-8 ${i > 0 ? "border-t border-[var(--lp-border)] lg:border-l lg:border-t-0" : ""}`}
            style={plan.current ? { background: "linear-gradient(180deg, rgba(255,61,127,0.07), transparent 55%)" } : undefined}
          >
            {plan.current ? <span className="absolute inset-x-0 top-0 h-px bg-[var(--lp-accent)] opacity-70" aria-hidden="true" /> : null}
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[16px] font-medium">{plan.name}</h3>
              {plan.current ? (
                <span className="rounded-full border border-[rgba(255,61,127,0.35)] bg-[rgba(255,61,127,0.1)] px-2 py-0.5 text-[11px] text-[#ff8fb3]">Available now</span>
              ) : (
                <span className="rounded-full border border-[var(--lp-border)] px-2 py-0.5 text-[11px] text-[var(--lp-subtle)]">In development</span>
              )}
            </div>
            <p className="mt-2 min-h-[44px] text-[14px] leading-relaxed text-[var(--lp-muted)]">{plan.audience}</p>

            <div className="mt-6 flex items-baseline gap-2">
              <span className="text-[40px] font-normal leading-none tracking-[-0.03em]">{plan.price}</span>
              {plan.id === "free" ? <span className="text-[14px] text-[var(--lp-muted)]">/ month</span> : null}
            </div>
            <p className="mt-2 text-[13px] text-[var(--lp-subtle)]">{plan.priceNote}</p>

            <Link href={plan.cta.href} className={`lp-btn mt-7 w-full ${plan.current ? "lp-btn-primary" : "lp-btn-secondary"}`}>
              {plan.cta.label}
            </Link>

            <div className="mt-8 border-t border-[var(--lp-border)] pt-6">
              <p className="text-[13px] font-medium text-[var(--lp-text)]">{plan.inherits ?? "Includes"}</p>
              <ul className="mt-4 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature.label} className="flex gap-3 text-[14px] leading-snug">
                    {feature.planned ? (
                      <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lp-subtle)]" aria-hidden="true" />
                    ) : (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lp-green)]" aria-hidden="true" />
                    )}
                    <span className={feature.planned ? "text-[var(--lp-muted)]" : "text-[var(--lp-text)]"}>
                      {feature.label}
                      {feature.planned ? <span className="sr-only"> (planned)</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>

      <p className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[13px] text-[var(--lp-subtle)]">
        <span className="inline-flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-[var(--lp-green)]" aria-hidden="true" /> Works today
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Planned, not available yet
        </span>
        <span>No credit card during the beta.</span>
      </p>

      <details className="group mt-12 rounded-2xl border border-[var(--lp-border)]">
        <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
          Compare plans
          <span className="text-[13px] font-normal text-[var(--lp-subtle)] group-open:hidden">Show the full table</span>
          <span className="hidden text-[13px] font-normal text-[var(--lp-subtle)] group-open:inline">Hide</span>
        </summary>
        <div className="overflow-x-auto border-t border-[var(--lp-border)]">
          <table className="w-full min-w-[540px] text-left text-[14px]">
            <thead>
              <tr className="text-[13px] text-[var(--lp-muted)]">
                <th className="w-[36%] px-6 py-3 font-normal">
                  <span className="sr-only">Feature</span>
                </th>
                {plans.map((plan) => (
                  <th key={plan.id} className="px-4 py-3 text-center font-medium text-[var(--lp-text)]">
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            {comparison.map((section) => (
              <tbody key={section.group}>
                <tr>
                  <th colSpan={4} className="border-t border-[var(--lp-border)] bg-white/[0.015] px-6 py-2 text-[12px] font-medium text-[var(--lp-subtle)]">
                    {section.group}
                  </th>
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.label} className="border-t border-[var(--lp-border)]">
                    <td className="px-6 py-3 text-[var(--lp-muted)]">{row.label}</td>
                    {row.values.map((value, i) => (
                      <td key={i} className="px-4 py-3 text-center">
                        <CellValue value={value} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </details>
    </div>
  );
}
