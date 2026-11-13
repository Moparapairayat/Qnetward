"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Clock3, Minus } from "@/components/icons";
import { apiRequest } from "@/lib/api";
import { comparisonRows, planCopy, proPricing, taka, type Cell, type Period, type PlanId } from "@/lib/plans";
import type { PublicPlansResponse } from "@/lib/types";

// Calls to action; everything else on the cards comes from the API.
const CTA: Record<PlanId, { label: string; href: string }> = {
  free: { label: "Start free", href: "/signup" },
  pro: { label: "Start with Pro", href: "/signup" },
  enterprise: { label: "Contact sales", href: "mailto:sales@qnetward.com?subject=Qnetward%20Enterprise" },
};

function CellValue({ value }: { value: Cell }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-[var(--lp-green)]" aria-label="Included" />;
  if (value === false) return <Minus className="mx-auto h-4 w-4 text-[var(--lp-subtle)] opacity-50" aria-label="Not included" />;
  if (value === "planned")
    return (
      <span className="inline-flex items-center gap-1 text-xs text-[var(--lp-subtle)]">
        <Clock3 className="h-3 w-3" aria-hidden="true" /> Planned
      </span>
    );
  return <span className="text-sm text-[var(--lp-text)]">{value}</span>;
}

type PricingProps = {
  /** The price list rendered on the server; fetched in the browser when missing. */
  initial?: PublicPlansResponse | null;
  defaultPeriod?: Period;
  /** In the console: the workspace's plan, marked Current. */
  current?: PlanId;
  /** In the console: each plan's button. The landing page links to signup instead. */
  renderAction?: (id: PlanId, period: Period) => ReactNode;
  /** The landing page fades sections in as they scroll into view. */
  reveal?: boolean;
};

/**
 * The plan cards, the monthly / yearly switch, and the comparison table. The
 * landing page and the console's Plans page both use this, so they always
 * show the same prices and limits.
 */
export function Pricing({ initial, defaultPeriod = "yearly", current, renderAction, reveal = false }: PricingProps) {
  const [period, setPeriod] = useState<Period>(defaultPeriod);
  // The server renders the page with the price list; the browser fetches it
  // only if that failed (during a build, say).
  const query = useQuery({
    queryKey: ["public-plans"],
    queryFn: () => apiRequest<PublicPlansResponse>("/api/plans"),
    initialData: initial ?? undefined,
    staleTime: 300_000,
  });
  const catalog = query.data;
  const pro = proPricing(catalog?.plans.find((p) => p.id === "pro")?.prices ?? []);
  const hasBoth = Boolean(pro.monthly && pro.yearly);
  const shown = (period === "yearly" ? pro.yearly : pro.monthly) ?? pro.monthly ?? pro.yearly;

  const priceFor = (id: PlanId) => {
    if (id === "free") return { amount: taka(0), unit: "forever", note: "No card needed" };
    if (id === "enterprise") return { amount: "Custom", unit: "", note: "Annual agreement, invoiced" };
    if (!shown) return { amount: "Pro", unit: "", note: "Pricing coming soon" };
    return shown.months === 12
      ? { amount: taka(shown.perMonth), unit: "/ month", note: `${taka(shown.total)} paid once for 12 months` }
      : { amount: taka(shown.total), unit: "/ month", note: "Paid a month at a time" };
  };

  if (!catalog) {
    return (
      <div className={`${reveal ? "lp-reveal " : ""}grid gap-4 lg:grid-cols-3`} aria-busy="true" aria-label="Loading prices">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[560px] animate-pulse rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-bg-raised)]" />
        ))}
      </div>
    );
  }

  return (
    <div className={reveal ? "lp-reveal" : undefined}>
      {hasBoth ? (
        <div className="mb-8 flex flex-wrap items-center justify-center gap-3">
          <div className="grid grid-cols-2 rounded-full border border-[var(--lp-border)] bg-[var(--lp-bg-raised)] p-1" role="radiogroup" aria-label="Billing period">
            {(["monthly", "yearly"] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={period === p}
                onClick={() => setPeriod(p)}
                className={`rounded-full px-5 py-1.5 text-base transition-colors ${period === p ? "bg-white/[0.1] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]"}`}
              >
                {p === "yearly" ? "Yearly" : "Monthly"}
              </button>
            ))}
          </div>
          {pro.saving > 0 ? (
            <span className="rounded-full bg-[rgba(74,222,128,0.1)] px-3 py-1 text-sm text-[#86efac]">
              Yearly saves {taka(pro.saving)}
              {pro.freeMonths ? ` · ${pro.freeMonths} months free` : ` · ${pro.savingPercent}% off`}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {catalog.plans.map((plan) => {
          const featured = plan.id === "pro";
          const price = priceFor(plan.id);
          const copy = planCopy(plan.id, plan.limits);
          // Pro sends the visitor through signup (or sign-in) straight to checkout,
          // with the period they picked here.
          const cta =
            plan.id === "pro" && catalog.payments_enabled
              ? { ...CTA.pro, href: `/signup?next=${encodeURIComponent(`/upgrade?period=${period}`)}` }
              : CTA[plan.id];
          return (
            <article
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border p-7 sm:p-8 ${featured ? "border-[rgba(255,61,127,0.5)] lg:-my-3 lg:py-11" : "border-[var(--lp-border)] bg-[var(--lp-bg-raised)]"}`}
              style={featured ? { background: "linear-gradient(180deg, rgba(255,61,127,0.09), rgba(255,61,127,0.02) 40%, var(--lp-bg-raised) 75%)" } : undefined}
            >
              <div className="flex h-7 items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">{plan.name}</h3>
                {plan.id === current ? (
                  <span className="rounded-full border border-[var(--lp-border-strong)] px-2.5 py-0.5 text-xs text-[var(--lp-text)]">Current plan</span>
                ) : featured ? (
                  <span className="rounded-full bg-[var(--lp-accent)] px-2.5 py-0.5 text-xs font-medium text-white">Recommended</span>
                ) : null}
              </div>
              <p className="mt-2 min-h-[48px] text-base leading-relaxed text-[var(--lp-muted)]">{copy.audience}</p>

              <div className="mt-6 flex h-11 items-baseline gap-2">
                <span className="text-3xl font-semibold leading-none tracking-[-0.03em]">{price.amount}</span>
                {price.unit ? <span className="text-base text-[var(--lp-muted)]">{price.unit}</span> : null}
              </div>
              <p className="mt-1 text-sm text-[var(--lp-subtle)]">{price.note}</p>

              <div className="mt-6">
                {renderAction ? (
                  renderAction(plan.id, period)
                ) : (
                  <Link href={cta.href} className={`lp-btn w-full ${featured ? "lp-btn-primary" : "lp-btn-secondary"}`}>
                    {cta.label}
                  </Link>
                )}
              </div>
              <p className="mt-2.5 h-4 text-center text-xs text-[var(--lp-subtle)]">{featured && catalog.payments_enabled ? "bKash · Nagad · Rocket · Card" : ""}</p>

              <dl className="mt-6 grid grid-cols-3 gap-2 rounded-xl border border-[var(--lp-border)] bg-black/20 p-3 text-center">
                {copy.headline.map(([label, value]) => (
                  <div key={label}>
                    <dd className="text-md font-medium text-[var(--lp-text)]">{value}</dd>
                    <dt className="mt-0.5 text-2xs text-[var(--lp-subtle)]">{label}</dt>
                  </div>
                ))}
              </dl>

              <div className="mt-6">
                <p className="text-sm font-medium text-[var(--lp-text)]">{copy.inherits ?? "Includes"}</p>
                <ul className="mt-4 space-y-3">
                  {copy.features.map((feature) => (
                    <li key={feature.label} className="flex gap-3 text-base leading-snug">
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

      <p className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-sm text-[var(--lp-subtle)]">
        <span className="inline-flex items-center gap-1.5">
          <Check className="h-3.5 w-3.5 text-[var(--lp-green)]" aria-hidden="true" /> Works today
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Planned, not available yet
        </span>
        <span>Free needs no card. Pro is paid ahead in taka and never renews by itself.</span>
      </p>

      <div className="mt-10 flex flex-col items-center gap-4">
        <p className="text-sm font-medium text-[var(--lp-muted)]">Pay with</p>
        <Image
          src="/payments/payment-methods.webp"
          alt="Accepted payment methods: bKash, Nagad, Rocket, City Bank, Dutch-Bangla Bank, BRAC Bank, Visa, PayPal, Maestro, American Express, Discover, Mastercard, JCB, UnionPay, and Stripe"
          width={530}
          height={96}
          className="h-auto w-full max-w-[530px]"
        />
      </div>

      <details className="group mt-12 rounded-2xl border border-[var(--lp-border)]">
        <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 text-md font-medium [&::-webkit-details-marker]:hidden">
          Compare plans
          <span className="text-sm font-normal text-[var(--lp-subtle)] group-open:hidden">Show the full table</span>
          <span className="hidden text-sm font-normal text-[var(--lp-subtle)] group-open:inline">Hide</span>
        </summary>
        <div className="overflow-x-auto border-t border-[var(--lp-border)]">
          <table className="w-full min-w-[540px] text-left text-base">
            <thead>
              <tr className="text-sm text-[var(--lp-muted)]">
                <th className="w-[36%] px-6 py-3 font-normal">
                  <span className="sr-only">Feature</span>
                </th>
                {catalog.plans.map((plan) => (
                  <th key={plan.id} className="px-4 py-3 text-center font-medium text-[var(--lp-text)]">
                    {plan.name}
                  </th>
                ))}
              </tr>
            </thead>
            {comparisonRows(catalog).map((section) => (
              <tbody key={section.group}>
                <tr>
                  <th colSpan={4} className="border-t border-[var(--lp-border)] bg-white/[0.015] px-6 py-2 text-xs font-medium text-[var(--lp-subtle)]">
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
