"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { apiRequest, ApiError } from "@/lib/api";
import type { PlanLimits, SessionResponse, WorkspaceTeamResponse, WorkspaceUsageResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Notice, SettingsCard, SettingsPageTitle } from "@/components/settings/settings-ui";

type PlanId = "free" | "pro" | "enterprise";

// Mirrors the public pricing on the landing page (features/landing/pricing.tsx).
const PLANS: { id: PlanId; name: string; price: string; blurb: string; features: string[] }[] = [
  {
    id: "free",
    name: "Free",
    price: "$0 during beta",
    blurb: "Everything that works today, for you and your team.",
    features: ["All four diagnostic tools", "HTTP(S), TCP, and ping monitors", "Email alerts and alert rules", "API keys, audit log, roles", "CSV and JSON export"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "Coming soon",
    blurb: "Continuous monitoring from more places.",
    features: ["Everything in Free, with higher limits", "Probe agents for private networks", "Multi-region probing", "Slack, Telegram, Discord, webhooks"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
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

function statusLabel(status?: string) {
  switch (status) {
    case "active":
      return { text: "Active", tone: "good" as const };
    case "past_due":
      return { text: "Payment due", tone: "bad" as const };
    case "canceled":
      return { text: "Canceled", tone: "muted" as const };
    default:
      return { text: "Beta", tone: "muted" as const };
  }
}

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

function limitLines(limits?: PlanLimits) {
  if (!limits) return [];
  return [
    `${limits.monitors.toLocaleString()} monitors`,
    `${limits.members.toLocaleString()} members`,
    `${limits.api_keys.toLocaleString()} API keys`,
    `${limits.probes_per_hour.toLocaleString()} probes and ${limits.scans_per_hour.toLocaleString()} port scans an hour`,
  ];
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

  const workspace = teamQuery.data?.workspace;
  const usage = usageQuery.data?.usage;
  const limits = usageQuery.data?.plan.limits;
  const current = planFor(workspace?.plan);
  const status = statusLabel(workspace?.billing_status);
  const plan = PLANS.find((p) => p.id === current) ?? PLANS[0];
  const isOwner = workspace?.role === "owner";

  return (
    <div className="grid grid-cols-1 gap-5">
      <SettingsPageTitle title="Billing and plan" description={`The plan and usage for ${workspace?.name ?? "this workspace"}.`} />

      {teamQuery.isError ? <Notice tone="error">{(teamQuery.error as ApiError).message || "Couldn't load billing details."}</Notice> : null}

      <SettingsCard
        id="plan"
        title="Current plan"
        description="Qnetward is free while in beta. Paid plans and invoices arrive with Pro."
        hint={isOwner ? "You'll be able to change plans here." : "Only workspace owners can change the plan."}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--lp-border)] bg-white/[0.02] p-4">
          <div>
            <p className="flex items-center gap-2 text-[18px] font-medium tracking-[-0.01em]">
              {plan.name}
              <span
                className={cn(
                  "rounded-md border px-1.5 py-px text-[11px] font-normal",
                  status.tone === "good"
                    ? "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]"
                    : status.tone === "bad"
                      ? "border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] text-[#ff8fb3]"
                      : "border-[var(--lp-border)] bg-white/[0.03] text-[var(--lp-muted)]",
                )}
              >
                {status.text}
              </span>
            </p>
            <p className="mt-0.5 text-[13px] text-[var(--lp-muted)]">{plan.price}</p>
          </div>
          <p className="max-w-xs text-[12px] leading-relaxed text-[var(--lp-subtle)]">{plan.blurb}</p>
        </div>
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

      <SettingsCard id="plans" title="Plans" description="Pro and Enterprise aren't available to buy yet.">
        <div className="grid gap-3 md:grid-cols-3">
          {PLANS.map((p) => {
            const isCurrent = p.id === current;
            return (
              <div
                key={p.id}
                className={cn(
                  "flex flex-col rounded-lg border p-4",
                  isCurrent ? "border-[rgba(255,61,127,0.45)] bg-[rgba(255,61,127,0.04)]" : "border-[var(--lp-border)]",
                )}
              >
                <div className="flex items-center justify-between">
                  <p className="text-[14px] font-medium">{p.name}</p>
                  {isCurrent ? <span className="rounded border border-[rgba(255,61,127,0.4)] px-1.5 text-[11px] leading-4 text-[#ff8fb3]">Current</span> : null}
                </div>
                <p className="mt-0.5 text-[12px] text-[var(--lp-subtle)]">{p.price}</p>
                <ul className="mt-3 grid gap-1.5 text-[12px] text-[var(--lp-muted)]">
                  {[...p.features, ...limitLines(usageQuery.data?.plans.find((plan) => plan.id === p.id)?.limits)].map((f) => (
                    <li key={f} className="flex items-start gap-1.5">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-[var(--lp-subtle)]" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard id="invoices" title="Invoices" description="Receipts for paid plans will be listed here.">
        <p className="rounded-lg border border-dashed border-[var(--lp-border)] px-4 py-5 text-center text-[13px] text-[var(--lp-subtle)]">No invoices. This workspace is on the free beta.</p>
      </SettingsCard>
    </div>
  );
}
