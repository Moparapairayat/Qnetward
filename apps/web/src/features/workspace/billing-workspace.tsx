"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/api";
import type { BillingPayment, BillingResponse, SessionResponse, WorkspaceTeamResponse, WorkspaceUsageResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { planCopy, proPricing, taka, type PlanId } from "@/lib/plans";
import { formatDate, Notice, SettingsCard, SettingsPageTitle } from "@/components/settings/settings-ui";

const PLAN_NAMES: Record<PlanId, string> = { free: "Free", pro: "Pro", enterprise: "Enterprise" };

// The workspace record still uses the pre-launch plan names.
function planFor(stored?: string): PlanId {
  if (stored === "pro") return "pro";
  if (stored === "enterprise") return "enterprise";
  return "free";
}

const METHOD_NAMES: Record<string, string> = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };
const methodName = (m?: string) => (m ? (METHOD_NAMES[m.toLowerCase()] ?? m) : "");

/** One limit: how much is used, the plan's cap, and a bar that warms up near the cap. */
function UsageMeter({ label, used, limit, detail, href }: { label: string; used: number; limit: number; detail: string; href?: string }) {
  const share = limit > 0 ? Math.min(1, used / limit) : 0;
  const tone = share >= 1 ? "#ff3d7f" : share >= 0.8 ? "#fbbf24" : "#4ade80";
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm">{label}</p>
        <p className="lp-mono text-sm">
          {used.toLocaleString()} <span className="text-[var(--lp-subtle)]">/ {limit.toLocaleString()}</span>
        </p>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={label}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(share * 100, used > 0 ? 2 : 0)}%`, background: tone }} />
      </div>
      <p className="mt-1.5 text-xs text-[var(--lp-subtle)]">{detail}</p>
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
    case "unpaid":
      return <Notice tone="info">The payment wasn&apos;t finished, so nothing was charged. Pick Pro again whenever you&apos;re ready.</Notice>;
    case "cancelled":
      return <Notice tone="info">Payment cancelled. Your plan hasn&apos;t changed.</Notice>;
    default:
      return null;
  }
}

/**
 * Where to change plan: one wide line here, and the full cards on the Plans
 * page, which has room to compare them.
 */
function PlanBanner({ billing, plans, current }: { billing?: BillingResponse; plans?: WorkspaceUsageResponse["plans"]; current: PlanId }) {
  const pro = proPricing((billing?.prices ?? []).filter((p) => p.plan === "pro"));
  const from = pro.yearly ?? pro.monthly;
  const proLimits = plans?.find((p) => p.id === "pro")?.limits;
  if (current === "enterprise") return null;

  const title = current === "pro" ? "Keep Pro going" : "Grow into Pro";
  const body =
    current === "pro"
      ? "Add a month or a year before it ends; the time is added after what you already have."
      : proLimits
        ? `${proLimits.monitors.toLocaleString("en-US")} monitors, ${proLimits.status_pages} status pages, ${proLimits.agents} probe agents, and ${proLimits.deep_scans_per_month} deep scans a month.`
        : "Higher limits for teams that rely on Qnetward every day.";
  return (
    <section
      aria-labelledby="plan-banner-title"
      className="flex flex-col gap-4 rounded-xl border border-[rgba(255,61,127,0.35)] bg-[linear-gradient(100deg,rgba(255,61,127,0.10),rgba(255,61,127,0.02)_55%,transparent)] p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <h2 id="plan-banner-title" className="text-md font-medium">
          {title}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--lp-muted)]">{body}</p>
        {from && current !== "pro" ? (
          <p className="mt-1.5 text-sm">
            From <span className="font-medium text-[var(--lp-text)]">{taka(from.perMonth)}</span>
            <span className="text-[var(--lp-subtle)]"> / month{from.months === 12 ? ", paid yearly" : ""}</span>
          </p>
        ) : null}
      </div>
      <Link href="/upgrade" className="console-btn console-btn-primary h-9 shrink-0 justify-center px-4">
        {current === "pro" ? "Add time" : "See plans"}
      </Link>
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
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
      <span className="w-28 shrink-0 text-[var(--lp-muted)]">{formatDate(payment.paid_at ?? payment.created_at)}</span>
      <span className="min-w-0 flex-1">
        Pro · {payment.months === 12 ? "12 months" : `${payment.months} month${payment.months === 1 ? "" : "s"}`}
        {payment.payment_method ? <span className="text-[var(--lp-subtle)]"> · {methodName(payment.payment_method)}</span> : null}
        {payment.transaction_id ? <span className="lp-mono ml-2 text-2xs text-[var(--lp-subtle)]">{payment.transaction_id}</span> : null}
      </span>
      <span className="lp-mono">{taka(payment.amount)}</span>
      <span className={cn("rounded border px-1.5 text-2xs leading-5 capitalize", tone)}>{payment.status}</span>
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
  const currentLimits = usageQuery.data?.plans?.find((p) => p.id === current)?.limits;
  const plan = { name: PLAN_NAMES[current], blurb: currentLimits ? planCopy(current, currentLimits).audience : "" };
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
            <p className="flex items-center gap-2 text-lg font-medium tracking-[-0.01em]">
              {plan.name}
              {current !== "free" ? (
                <span className="rounded-md border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] px-1.5 py-px text-2xs font-normal text-[#86efac]">Active</span>
              ) : null}
            </p>
            <p className="mt-0.5 text-sm text-[var(--lp-muted)]">
              {current === "free" ? "Free for every workspace" : expires ? `Paid through ${formatDate(expires)}` : "Set up by Qnetward, no renewal needed"}
            </p>
          </div>
          <p className="max-w-xs text-xs leading-relaxed text-[var(--lp-subtle)]">
            {current === "pro" && expires ? "Add more time from Plans before it ends; it's added after the current period." : plan.blurb}
          </p>
        </div>
        {usage?.data_region ? (
          <p className="mt-3 text-xs text-[var(--lp-subtle)]">
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
          <p className="text-sm text-[var(--lp-subtle)]">Loading…</p>
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

      <PlanBanner billing={billing} plans={usageQuery.data?.plans} current={current} />

      <SettingsCard id="invoices" title="Payments" description="Receipts for Pro, newest first. Only owners and admins see them.">
        {payments.length ? (
          <ul className="divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)]">
            {payments.map((p) => (
              <PaymentRow key={p.id} payment={p} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--lp-border)] px-4 py-5 text-center text-sm text-[var(--lp-subtle)]">No payments yet.</p>
        )}
      </SettingsCard>
    </div>
  );
}
