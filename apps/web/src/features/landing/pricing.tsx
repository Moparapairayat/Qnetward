"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Clock3, Minus } from "lucide-react";

type Feature = { label: string; planned?: boolean };
type Period = "monthly" | "yearly";

type Plan = {
  id: "free" | "pro" | "enterprise";
  name: string;
  audience: string;
  inherits?: string;
  limits: [string, string][];
  features: Feature[];
  cta: { label: string; href: string };
};

// Pro's price in taka. Keep in step with QNETWARD_PRO_MONTHLY_BDT and
// QNETWARD_PRO_YEARLY_BDT on the server.
const PRO_MONTHLY = 1500;
const PRO_YEARLY = 15000;
const bdt = (n: number) => `BDT ${n.toLocaleString("en-US")}`;

const plans: Plan[] = [
  {
    id: "free",
    name: "Free",
    audience: "Everything you need to start monitoring, for you and your team.",
    limits: [
      ["Monitors", "20"],
      ["Members", "25"],
      ["Probes", "600 / hr"],
    ],
    features: [
      { label: "ICMP ping, TCP ping, port scan, DNS lookup" },
      { label: "HTTP(S), TCP, and ping monitors" },
      { label: "Alerts by email, Slack, Discord, Telegram, or webhook" },
      { label: "Workspaces, roles, API keys, audit log" },
      { label: "CSV and JSON export" },
    ],
    cta: { label: "Start free", href: "/signup" },
  },
  {
    id: "pro",
    name: "Pro",
    audience: "For teams that rely on Qnetward every day and need room to grow.",
    inherits: "Everything in Free, plus",
    limits: [
      ["Monitors", "200"],
      ["Members", "100"],
      ["Probes", "3,000 / hr"],
    ],
    features: [
      { label: "Ten times the monitors" },
      { label: "Priority email support" },
      { label: "Probe agents for private networks", planned: true },
      { label: "Multi-region probing", planned: true },
      { label: "Longer history retention", planned: true },
    ],
    cta: { label: "Start with Pro", href: "/signup" },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    audience: "For ISPs, MSPs, and regulated teams with their own requirements.",
    inherits: "Everything in Pro, plus",
    limits: [
      ["Monitors", "2,000"],
      ["Members", "1,000"],
      ["Probes", "20,000 / hr"],
    ],
    features: [
      { label: "SSO (SAML, OIDC) and SCIM", planned: true },
      { label: "Dedicated or self-hosted deployment", planned: true },
      { label: "Authorized deep security scanning", planned: true },
      { label: "Audit log export and data residency", planned: true },
      { label: "Priority support and an SLA", planned: true },
    ],
    cta: { label: "Contact sales", href: "mailto:sales@qnetward.com?subject=Qnetward%20Enterprise" },
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

function priceFor(id: Plan["id"], period: Period) {
  if (id === "free") return { amount: "BDT 0", unit: "forever", note: "No card needed" };
  if (id === "enterprise") return { amount: "Custom", unit: "", note: "Annual agreement, invoiced" };
  return period === "yearly"
    ? { amount: bdt(Math.round(PRO_YEARLY / 12)), unit: "/ month", note: `${bdt(PRO_YEARLY)} billed yearly` }
    : { amount: bdt(PRO_MONTHLY), unit: "/ month", note: "Billed every month" };
}

export function Pricing() {
  const [period, setPeriod] = useState<Period>("yearly");
  const saving = PRO_MONTHLY * 12 - PRO_YEARLY;

  return (
    <div className="lp-reveal">
      <div className="mb-8 flex flex-wrap items-center justify-center gap-3">
        <div className="grid grid-cols-2 rounded-full border border-[var(--lp-border)] bg-[var(--lp-bg-raised)] p-1" role="radiogroup" aria-label="Billing period">
          {(["monthly", "yearly"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={period === p}
              onClick={() => setPeriod(p)}
              className={`rounded-full px-5 py-1.5 text-[14px] transition-colors ${period === p ? "bg-white/[0.1] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]"}`}
            >
              {p === "yearly" ? "Yearly" : "Monthly"}
            </button>
          ))}
        </div>
        <span className="rounded-full bg-[rgba(74,222,128,0.1)] px-3 py-1 text-[13px] text-[#86efac]">Yearly saves {bdt(saving)}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((plan) => {
          const featured = plan.id === "pro";
          const price = priceFor(plan.id, period);
          return (
            <article
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border p-7 sm:p-8 ${featured ? "border-[rgba(255,61,127,0.5)] lg:-my-3 lg:py-11" : "border-[var(--lp-border)] bg-[var(--lp-bg-raised)]"}`}
              style={featured ? { background: "linear-gradient(180deg, rgba(255,61,127,0.09), rgba(255,61,127,0.02) 40%, var(--lp-bg-raised) 75%)" } : undefined}
            >
              <div className="flex h-7 items-center justify-between gap-3">
                <h3 className="text-[17px] font-semibold">{plan.name}</h3>
                {featured ? (
                  <span className="rounded-full bg-[var(--lp-accent)] px-2.5 py-0.5 text-[12px] font-medium text-white">Recommended</span>
                ) : null}
              </div>
              <p className="mt-2 min-h-[48px] text-[14px] leading-relaxed text-[var(--lp-muted)]">{plan.audience}</p>

              <div className="mt-6 flex h-11 items-baseline gap-2">
                <span className="text-[38px] font-semibold leading-none tracking-[-0.03em]">{price.amount}</span>
                {price.unit ? <span className="text-[14px] text-[var(--lp-muted)]">{price.unit}</span> : null}
              </div>
              <p className="mt-1 text-[13px] text-[var(--lp-subtle)]">{price.note}</p>

              <Link href={plan.cta.href} className={`lp-btn mt-6 w-full ${featured ? "lp-btn-primary" : "lp-btn-secondary"}`}>
                {plan.cta.label}
              </Link>
              <p className="mt-2.5 h-4 text-center text-[12px] text-[var(--lp-subtle)]">{featured ? "bKash · Nagad · Rocket · Card" : ""}</p>

              <dl className="mt-6 grid grid-cols-3 gap-2 rounded-xl border border-[var(--lp-border)] bg-black/20 p-3 text-center">
                {plan.limits.map(([label, value]) => (
                  <div key={label}>
                    <dd className="text-[15px] font-medium text-[var(--lp-text)]">{value}</dd>
                    <dt className="mt-0.5 text-[11px] text-[var(--lp-subtle)]">{label}</dt>
                  </div>
                ))}
              </dl>

              <div className="mt-6">
                <p className="text-[13px] font-medium text-[var(--lp-text)]">{plan.inherits ?? "Includes"}</p>
                <ul className="mt-4 space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature.label} className="flex gap-3 text-[14px] leading-snug">
                      {feature.planned ? (
                        <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--lp-subtle)]" aria-hidden="true" />
                      ) : (
                        <Check className={`mt-0.5 h-4 w-4 shrink-0 ${featured ? "text-[var(--lp-accent)]" : "text-[var(--lp-green)]"}`} aria-hidden="true" />
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
          );
        })}
      </div>

      <p className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[13px] text-[var(--lp-subtle)]">
        <span className="inline-flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-[var(--lp-green)]" aria-hidden="true" /> Works today
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Planned, not available yet
        </span>
        <span>Free needs no card. Pro is paid ahead in taka, with no auto-renewal.</span>
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
