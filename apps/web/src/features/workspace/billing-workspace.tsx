"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Lock } from "lucide-react";
import { apiRequest, ApiError } from "@/lib/api";
import type { BillingPayment, BillingResponse, PlanLimits, SessionResponse, WorkspaceTeamResponse, WorkspaceUsageResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate, Notice, SettingsCard, SettingsPageTitle } from "@/components/settings/settings-ui";

type PlanId = "free" | "pro" | "enterprise";

// Mirrors the public pricing on the landing page (features/landing/pricing.tsx).
const PLANS: { id: PlanId; name: string; blurb: string; features: string[] }[] = [
  {
    id: "free",
    name: "Free",
    blurb: "Everything you need to start monitoring.",
    features: [
      "All four diagnostic tools",
      "HTTP(S), TCP, and ping monitors",
      "Email, Slack, Discord, Telegram, and webhook alerts",
      "API keys, audit log, roles",
      "CSV and JSON export",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    blurb: "For teams that rely on Qnetward every day.",
    features: ["Everything in Free, with higher limits", "Probe agents for private networks, as they arrive", "Multi-region probing, as it arrives", "Priority email support"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    blurb: "For ISPs, MSPs, and regulated teams.",
    features: ["SSO and SCIM", "Dedicated or self-hosted", "Audit log export", "Priority support and SLA"],
  },
];

// The workspace record still uses the pre-launch plan names.
function planFor(stored?: string): PlanId {
  if (stored === "pro") return "pro";
  if (stored === "enterprise") return "enterprise";
  return "free";
}

// "BDT" rather than ৳: the console font has no taka sign, and a fallback glyph looks broken.
const taka = (amount: number) => `BDT ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const METHOD_NAMES: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };
const methodName = (m?: string) => (m ? (METHOD_NAMES[m.toLowerCase()] ?? m) : "");

/** One limit: how much is used, the plan's cap, and a bar that warms up near the cap. */
function UsageMeter({ label, used, limit, detail, href }: { label: string; used: number; limit: number; detail: string; href?: string }) {
  const share = limit > 0 ? Math.min(1, used / limit) : 0;
  const tone = share >= 1 ? "#ff3d7f" : share >= 0.8 ? "#fbbf24" : "#4ade80";
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px]">{label}</p>
        <p className="lp-mono text-[13px]">
          {used.toLocaleString()} <span className="text-[var(--lp-subtle)]">/ {limit.toLocaleString()}</span>
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={label}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(share * 100, used > 0 ? 2 : 0)}%`, background: tone }} />
      </div>
      <p className="mt-1.5 text-[12px] text-[var(--lp-subtle)]">{detail}</p>
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="block px-4 py-3 transition-colors hover:bg-white/[0.02]">
          {body}
        </Link>
      ) : (
        <div className="px-4 py-3">{body}</div>
      )}
    </li>
  );
}

const REGION_NAMES: Record<string, string> = {
  "ap-southeast-1": "Singapore",
  "eu-central-1": "Frankfurt",
  "us-east-1": "N. Virginia",
};

/** What happened at the gateway, read from ?payment= on the way back. */
function PaymentResult() {
  const outcome = useSearchParams().get("payment");
  switch (outcome) {
    case "success":
      return <Notice tone="success">Payment received. Pro is active on this workspace; the receipt is below.</Notice>;
    case "pending":
      return <Notice tone="info">The payment is still being confirmed. Pro turns on as soon as UddoktaPay marks it complete.</Notice>;
    case "failed":
      return <Notice tone="error">The payment didn&apos;t go through, and nothing was charged to the plan. Try again, or use another method.</Notice>;
    case "cancelled":
      return <Notice tone="info">Payment cancelled. Your plan hasn&apos;t changed.</Notice>;
    default:
      return null;
  }
}

type Period = 1 | 12;

const LIMIT_ROWS: { key: keyof PlanLimits; label: string; suffix?: string }[] = [
  { key: "monitors", label: "Monitors" },
  { key: "members", label: "Members" },
  { key: "api_keys", label: "API keys" },
  { key: "probes_per_hour", label: "Probes", suffix: "/ hr" },
  { key: "scans_per_hour", label: "Port scans", suffix: "/ hr" },
];

/**
 * The three plans side by side. Every card has the same rows in the same
 * places, price, line, action, limits, features, so they compare at a glance.
 */
function PlansGrid({ billing, plans, current }: { billing?: BillingResponse; plans?: WorkspaceUsageResponse["plans"]; current: PlanId }) {
  const prices = (billing?.prices ?? []).filter((p) => p.plan === "pro");
  const monthly = prices.find((p) => p.months === 1);
  const yearly = prices.find((p) => p.months === 12);
  // Yearly by default; falls back to whichever price the server offers.
  const [period, setPeriod] = useState<Period>(12);
  const price = (period === 12 ? yearly : monthly) ?? monthly ?? yearly;
  const saving = monthly && yearly ? monthly.amount * 12 - yearly.amount : 0;
  const canBuy = Boolean(billing?.payments_enabled && price);

  const checkout = useMutation({
    mutationFn: () => apiRequest<{ payment_url: string }>("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: "pro", months: period }) }),
    onSuccess: (resp) => {
      window.location.href = resp.payment_url;
    },
  });

  const priceFor = (id: PlanId) => {
    if (id === "free") return { amount: "BDT 0", unit: "forever", note: "No card needed" };
    if (id === "enterprise") return { amount: "Custom", unit: "", note: "Annual agreement" };
    if (!price) return { amount: "Pro", unit: "", note: "Pricing isn't set on this server" };
    return period === 12
      ? { amount: taka(Math.round(price.amount / 12)), unit: "/ month", note: `${taka(price.amount)} billed yearly` }
      : { amount: taka(price.amount), unit: "/ month", note: "Billed every month" };
  };

  const action = (id: PlanId) => {
    const isCurrent = id === current;
    if (id === "free") {
      return (
        <button type="button" className="console-btn console-btn-secondary h-9 w-full justify-center" disabled>
          {isCurrent ? "Your current plan" : "Included with every workspace"}
        </button>
      );
    }
    if (id === "enterprise") {
      return (
        <a href="mailto:sales@qnetward.com?subject=Qnetward%20Enterprise" className="console-btn console-btn-secondary h-9 w-full justify-center">
          {isCurrent ? "Your current plan" : "Contact sales"}
        </a>
      );
    }
    if (current === "enterprise") {
      return (
        <button type="button" className="console-btn console-btn-secondary h-9 w-full justify-center" disabled>
          Included in Enterprise
        </button>
      );
    }
    if (!canBuy) {
      return (
        <button type="button" className="console-btn console-btn-secondary h-9 w-full justify-center" disabled title="Online payment isn't set up on this server yet">
          <Lock className="h-3.5 w-3.5" /> Not available yet
        </button>
      );
    }
    return (
      <button
        type="button"
        className="console-btn console-btn-primary h-9 w-full justify-center"
        disabled={!billing?.can_pay || checkout.isPending}
        title={billing?.can_pay ? undefined : "Only workspace owners and admins can pay"}
        onClick={() => checkout.mutate()}
      >
        {checkout.isPending ? "Opening checkout…" : isCurrent ? `Add ${period === 12 ? "a year" : "a month"}` : "Upgrade to Pro"}
      </button>
    );
  };

  return (
    <section aria-labelledby="plans-title" className="rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id="plans-title" className="text-[15px] font-medium">
            Plans
          </h2>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-[var(--lp-muted)]">
            Pro is paid ahead, a month or a year at a time. When it ends, the workspace goes back to Free and keeps everything.
          </p>
        </div>
        {monthly && yearly ? (
          <div className="flex items-center gap-2">
            <div className="grid grid-cols-2 rounded-lg border border-[var(--lp-border)] bg-black/20 p-0.5" role="radiogroup" aria-label="Billing period">
              {([1, 12] as Period[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={period === m}
                  onClick={() => setPeriod(m)}
                  className={cn(
                    "rounded-md px-3 py-1 text-[12px] font-medium transition-colors",
                    period === m ? "bg-white/[0.1] text-white" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]",
                  )}
                >
                  {m === 12 ? "Yearly" : "Monthly"}
                </button>
              ))}
            </div>
            {saving > 0 ? <span className="rounded-md bg-[rgba(74,222,128,0.1)] px-2 py-1 text-[11px] font-medium text-[#86efac]">Save {taka(saving)}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {PLANS.map((p) => {
          const isCurrent = p.id === current;
          const featured = p.id === "pro";
          const pr = priceFor(p.id);
          const limits = plans?.find((plan) => plan.id === p.id)?.limits;
          return (
            <div
              key={p.id}
              className={cn(
                "relative flex flex-col rounded-xl border p-5",
                featured ? "border-[rgba(255,61,127,0.5)] bg-[linear-gradient(180deg,rgba(255,61,127,0.07),rgba(255,61,127,0)_45%)]" : "border-[var(--lp-border)] bg-white/[0.01]",
              )}
            >
              <div className="flex h-6 items-center justify-between gap-2">
                <p className="text-[15px] font-semibold">{p.name}</p>
                {isCurrent ? (
                  <span className="rounded-full border border-[var(--lp-border-strong)] px-2 text-[11px] leading-5 text-[var(--lp-text)]">Current</span>
                ) : featured ? (
                  <span className="rounded-full bg-[var(--lp-accent)] px-2 text-[11px] font-medium leading-5 text-white">Recommended</span>
                ) : null}
              </div>

              <p className="mt-4 flex h-8 items-baseline gap-1.5">
                <span className="text-[28px] font-semibold leading-none tracking-[-0.02em]">{pr.amount}</span>
                {pr.unit ? <span className="text-[13px] text-[var(--lp-subtle)]">{pr.unit}</span> : null}
              </p>
              <p className="mt-1.5 truncate text-[12px] leading-4 text-[var(--lp-subtle)]">{pr.note}</p>
              <p className="mt-3 min-h-[36px] text-[13px] leading-snug text-[var(--lp-muted)]">{p.blurb}</p>

              <div className="mt-4">{action(p.id)}</div>
              {/* Same height on every card, so the limits below line up. */}
              <p className="mt-2 h-4 truncate text-center text-[11px] leading-4 text-[var(--lp-subtle)]">
                {featured && canBuy && current !== "enterprise" ? "bKash · Nagad · Rocket · Card" : ""}
              </p>
              {featured && checkout.isError ? <p className="mt-1 text-center text-[12px] text-[#ff8fb3]">{(checkout.error as ApiError).message}</p> : null}

              <dl className="mt-5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[var(--lp-border)] pt-4 text-[12px]">
                {LIMIT_ROWS.map((row) => (
                  <div key={row.key} className="contents">
                    <dt className="text-[var(--lp-subtle)]">{row.label}</dt>
                    <dd className="lp-mono text-right text-[var(--lp-text)]">
                      {limits ? limits[row.key].toLocaleString() : "—"}
                      {row.suffix ? <span className="font-sans text-[var(--lp-subtle)]"> {row.suffix}</span> : null}
                    </dd>
                  </div>
                ))}
              </dl>

              <ul className="mt-4 grid gap-2 border-t border-[var(--lp-border)] pt-4 text-[13px] text-[var(--lp-muted)]">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", featured ? "text-[var(--lp-accent)]" : "text-[var(--lp-green)]")} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PaymentRow({ payment }: { payment: BillingPayment }) {
  const tone =
    payment.status === "paid"
      ? "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]"
      : payment.status === "pending"
        ? "border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.08)] text-[#fcd34d]"
        : "border-[var(--lp-border)] bg-white/[0.03] text-[var(--lp-subtle)]";
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
      <span className="w-28 shrink-0 text-[var(--lp-muted)]">{formatDate(payment.paid_at ?? payment.created_at)}</span>
      <span className="min-w-0 flex-1">
        Pro · {payment.months === 12 ? "12 months" : `${payment.months} month${payment.months === 1 ? "" : "s"}`}
        {payment.payment_method ? <span className="text-[var(--lp-subtle)]"> · {methodName(payment.payment_method)}</span> : null}
        {payment.transaction_id ? <span className="lp-mono ml-2 text-[11px] text-[var(--lp-subtle)]">{payment.transaction_id}</span> : null}
      </span>
      <span className="lp-mono">{taka(payment.amount)}</span>
      <span className={cn("rounded border px-1.5 text-[11px] leading-5 capitalize", tone)}>{payment.status}</span>
    </li>
  );
}

export function BillingWorkspace() {
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => apiRequest<SessionResponse>("/api/auth/session") });
  const authenticated = sessionQuery.data?.authenticated === true;
  const teamQuery = useQuery({
    queryKey: ["workspace-team"],
    queryFn: () => apiRequest<WorkspaceTeamResponse>("/api/workspace/team"),
    enabled: authenticated,
  });
  const usageQuery = useQuery({
    queryKey: ["workspace-usage"],
    queryFn: () => apiRequest<WorkspaceUsageResponse>("/api/workspace/usage"),
    enabled: authenticated,
    refetchInterval: 30_000,
  });
  const billingQuery = useQuery({
    queryKey: ["workspace-billing"],
    queryFn: () => apiRequest<BillingResponse>("/api/billing"),
    enabled: authenticated,
  });

  const workspace = teamQuery.data?.workspace;
  const billing = billingQuery.data;
  const usage = usageQuery.data?.usage;
  const limits = usageQuery.data?.plan.limits;
  const current = planFor(billing?.plan ?? workspace?.plan);
  const plan = PLANS.find((p) => p.id === current) ?? PLANS[0];
  const expires = billing?.plan_expires_at ?? null;
  const payments = billing?.payments ?? [];

  return (
    <div className="grid grid-cols-1 gap-5">
      <SettingsPageTitle title="Billing and plan" description={`The plan and usage for ${workspace?.name ?? "this workspace"}.`} />

      <Suspense fallback={null}>
        <PaymentResult />
      </Suspense>
      {teamQuery.isError ? <Notice tone="error">{(teamQuery.error as ApiError).message || "Couldn't load billing details."}</Notice> : null}

      <SettingsCard id="plan" title="Current plan">
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--lp-border)] bg-white/[0.02] p-4">
          <div>
            <p className="flex items-center gap-2 text-[18px] font-medium tracking-[-0.01em]">
              {plan.name}
              {current !== "free" ? (
                <span className="rounded-md border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] px-1.5 py-px text-[11px] font-normal text-[#86efac]">Active</span>
              ) : null}
            </p>
            <p className="mt-0.5 text-[13px] text-[var(--lp-muted)]">
              {current === "free" ? "Free for every workspace" : expires ? `Paid through ${formatDate(expires)}` : "Set up by Qnetward, no renewal needed"}
            </p>
          </div>
          <p className="max-w-xs text-[12px] leading-relaxed text-[var(--lp-subtle)]">
            {current === "pro" && expires ? "Add more time from the Pro card below before it ends; it's added after the current period." : plan.blurb}
          </p>
        </div>
        {usage?.data_region ? (
          <p className="mt-3 text-[12px] text-[var(--lp-subtle)]">
            Data stored in <span className="text-[var(--lp-muted)]">{REGION_NAMES[usage.data_region] ?? usage.data_region}</span>{" "}
            <span className="lp-mono">({usage.data_region})</span>
          </p>
        ) : null}
      </SettingsCard>

      <SettingsCard
        id="usage"
        title="Usage"
        description={`What this workspace uses against the ${usageQuery.data?.plan.name ?? "current"} plan's limits. Hourly counts cover the last 60 minutes.`}
      >
        {usageQuery.isError ? (
          <Notice tone="error">{(usageQuery.error as ApiError).message || "Couldn't load usage."}</Notice>
        ) : !usage || !limits ? (
          <p className="text-[13px] text-[var(--lp-subtle)]">Loading…</p>
        ) : (
          <ul className="grid divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)] sm:grid-cols-2 sm:divide-y-0 [&>li]:border-[var(--lp-border)] sm:[&>li:nth-child(n+3)]:border-t sm:[&>li:nth-child(even)]:border-l">
            <UsageMeter
              label="Members"
              used={usage.members + usage.pending_invitations}
              limit={limits.members}
              detail={usage.pending_invitations ? `${usage.members} joined, ${usage.pending_invitations} invited` : "Pending invitations count too"}
              href="/workspace/team"
            />
            <UsageMeter label="Monitors" used={usage.monitors} limit={limits.monitors} detail="Scheduled checks" href="/monitors" />
            <UsageMeter label="API keys" used={usage.api_keys} limit={limits.api_keys} detail="Active keys" href="/workspace/api-keys" />
            <UsageMeter label="Probes this hour" used={usage.probes_last_hour} limit={limits.probes_per_hour} detail="Ping, TCP ping, and DNS runs" />
            <UsageMeter label="Port scans this hour" used={usage.scans_last_hour} limit={limits.scans_per_hour} detail="Every scan is in the audit log" href="/workspace/audit-log" />
          </ul>
        )}
      </SettingsCard>

      <PlansGrid billing={billing} plans={usageQuery.data?.plans} current={current} />

      <SettingsCard id="invoices" title="Payments" description="Receipts for Pro, newest first. Only owners and admins see them.">
        {payments.length ? (
          <ul className="divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)]">
            {payments.map((p) => (
              <PaymentRow key={p.id} payment={p} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--lp-border)] px-4 py-5 text-center text-[13px] text-[var(--lp-subtle)]">No payments yet.</p>
        )}
      </SettingsCard>
    </div>
  );
}
