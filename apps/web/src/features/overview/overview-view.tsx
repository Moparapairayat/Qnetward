"use client";

import Link from "next/link";
import { ArrowRight, Bell, Play, Radar, Users } from "@/components/icons";
import type { RuntimeHealthResponse } from "@/lib/types";
import type { OverviewTargetSnapshot } from "@/features/overview/overview-helpers";
import { cn } from "@/lib/utils";

export type QuickTool = "icmp" | "tcp" | "portscan" | "dns";

const toolOptions: { id: QuickTool; label: string; placeholder: string }[] = [
  { id: "icmp", label: "ICMP ping", placeholder: "Host or IP, e.g. 1.1.1.1" },
  { id: "tcp", label: "TCP ping", placeholder: "host:port, e.g. api.example.com:443" },
  { id: "portscan", label: "Port scan", placeholder: "Host or IP to scan" },
  { id: "dns", label: "DNS lookup", placeholder: "Domain, e.g. example.com" },
];

const stateMeta: Record<OverviewTargetSnapshot["healthState"], { label: string; color: string }> = {
  critical: { label: "Down", color: "#ff3d7f" },
  warning: { label: "Degraded", color: "#fbbf24" },
  stable: { label: "Healthy", color: "#4ade80" },
  idle: { label: "No recent data", color: "#85858e" },
  disabled: { label: "Paused", color: "#85858e" },
};

function relativeTime(ts?: number | null) {
  if (!ts) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatMs(value?: number | null) {
  if (typeof value !== "number") return "—";
  return value >= 100 ? `${Math.round(value)} ms` : `${value.toFixed(1)} ms`;
}

export function OverviewHeader({ health }: { health?: RuntimeHealthResponse }) {
  const deps = health ? [health.database, health.redis, health.object_storage].filter((d) => d.enabled) : [];
  const degraded = deps.some((d) => !d.healthy) || health?.ok === false;
  const label = !health ? "Checking services…" : degraded ? "Some services degraded" : "All services healthy";
  const color = !health ? "#85858e" : degraded ? "#fbbf24" : "#4ade80";

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-medium tracking-[-0.02em]">Overview</h1>
        <p className="mt-1 text-base text-[var(--lp-muted)]">Health of the targets your workspace probes. Refreshes every 20 seconds.</p>
      </div>
      <Link href="/status" className="flex items-center gap-2 text-sm text-[var(--lp-muted)] hover:text-[var(--lp-text)]">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </Link>
    </div>
  );
}

export function QuickProbe({
  tool,
  onToolChange,
  target,
  onTargetChange,
  onRun,
  disabled,
}: {
  tool: QuickTool;
  onToolChange: (tool: QuickTool) => void;
  target: string;
  onTargetChange: (value: string) => void;
  onRun: () => void;
  disabled?: boolean;
}) {
  const active = toolOptions.find((t) => t.id === tool) ?? toolOptions[0];
  return (
    <form
      className="min-w-0 rounded-xl border border-[var(--lp-border)] bg-[#0a0a0a] p-2"
      onSubmit={(event) => {
        event.preventDefault();
        onRun();
      }}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <div role="tablist" aria-label="Probe type" className="flex min-w-0 gap-1 overflow-x-auto rounded-lg bg-black/20 p-1 md:shrink-0">
          {toolOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={option.id === tool}
              onClick={() => onToolChange(option.id)}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
                option.id === tool ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <input
          value={target}
          onChange={(event) => onTargetChange(event.target.value)}
          placeholder={active.placeholder}
          aria-label="Target"
          disabled={disabled}
          className="h-10 min-w-0 flex-1 px-3"
        />
        <button type="submit" disabled={disabled} className="console-btn console-btn-primary h-10 px-4">
          <Play className="h-3.5 w-3.5" /> Run
        </button>
      </div>
    </form>
  );
}

export function StatRow({
  tracked,
  healthy,
  degraded,
  live,
}: {
  tracked: number;
  healthy: number;
  degraded: number;
  live: number;
}) {
  const stats = [
    { label: "Targets", value: tracked, hint: "with recent probes or alert rules" },
    { label: "Healthy", value: healthy, hint: "within their thresholds", color: healthy ? "#4ade80" : undefined },
    { label: "Need attention", value: degraded, hint: "degraded or down", color: degraded ? "#fbbf24" : undefined },
    { label: "Live now", value: live, hint: "streamed in the last 15s" },
  ];
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-[var(--lp-border)] bg-[#0a0a0a] lg:grid-cols-4">
      {stats.map((stat, i) => (
        <div
          key={stat.label}
          className={cn(
            "p-5",
            i % 2 === 1 && "border-l border-[var(--lp-border)]",
            i >= 2 && "border-t border-[var(--lp-border)] lg:border-t-0",
            i === 2 && "lg:border-l",
          )}
        >
          <dt className="text-sm text-[var(--lp-muted)]">{stat.label}</dt>
          <dd className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-medium tracking-[-0.02em]" style={{ color: stat.color }}>
              {stat.value}
            </span>
          </dd>
          <p className="mt-1 text-xs text-[var(--lp-subtle)]">{stat.hint}</p>
        </div>
      ))}
    </dl>
  );
}

export function LatencyCard({ points }: { points: { ts: number; rttMs?: number | null }[] }) {
  const values = points.map((p) => p.rttMs).filter((v): v is number => typeof v === "number");
  const w = 640;
  const h = 160;
  const max = Math.max(10, ...values) * 1.15;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const path = values.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;

  return (
    <section className="rounded-xl border border-[var(--lp-border)] bg-[#0a0a0a] p-5" aria-labelledby="latency-title">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="latency-title" className="text-md font-medium">
          Latency
        </h2>
        <span className="text-xs text-[var(--lp-subtle)]">last {values.length} samples, all targets</span>
      </div>
      {values.length > 1 ? (
        <svg viewBox={`0 0 ${w} ${h}`} className="mt-4 h-40 w-full" preserveAspectRatio="none" role="img" aria-label="Latency over recent samples">
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2={w} y1={h * f} y2={h * f} stroke="rgba(255,255,255,0.05)" />
          ))}
          <path d={`${path} L${w},${h} L0,${h} Z`} fill="rgba(255,61,127,0.08)" />
          <path d={path} fill="none" stroke="#ff3d7f" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <div className="mt-4 flex h-40 items-center justify-center rounded-lg border border-dashed border-[var(--lp-border)] text-sm text-[var(--lp-subtle)]">
          Run a probe to start the chart.
        </div>
      )}
      <dl className="mt-4 grid grid-cols-3 border-t border-[var(--lp-border)] pt-4 text-sm">
        {[
          ["Fastest", sorted[0]],
          ["Median", median],
          ["Slowest", sorted[sorted.length - 1]],
        ].map(([label, value]) => (
          <div key={label as string}>
            <dt className="text-[var(--lp-subtle)]">{label}</dt>
            <dd className="lp-mono mt-1 text-[var(--lp-text)]">{formatMs(value as number | undefined)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function StatusCard({ targets, alertRuleCount }: { targets: OverviewTargetSnapshot[]; alertRuleCount: number }) {
  const order: OverviewTargetSnapshot["healthState"][] = ["critical", "warning", "stable", "idle"];
  const total = targets.length || 1;
  return (
    <section className="flex flex-col rounded-xl border border-[var(--lp-border)] bg-[#0a0a0a] p-5" aria-labelledby="status-title">
      <h2 id="status-title" className="text-md font-medium">
        Status
      </h2>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-white/[0.06]">
        {order.map((state) => {
          const count = targets.filter((t) => t.healthState === state).length;
          return count ? <span key={state} style={{ width: `${(count / total) * 100}%`, background: stateMeta[state].color }} /> : null;
        })}
      </div>
      <ul className="mt-4 space-y-2.5 text-sm">
        {order.map((state) => (
          <li key={state} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[var(--lp-muted)]">
              <span className="h-2 w-2 rounded-full" style={{ background: stateMeta[state].color }} />
              {stateMeta[state].label}
            </span>
            <span className="lp-mono text-[var(--lp-text)]">{targets.filter((t) => t.healthState === state).length}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/alerts"
        className="mt-auto flex items-center justify-between border-t border-[var(--lp-border)] pt-4 text-sm text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
        style={{ marginTop: "auto" }}
      >
        <span className="flex items-center gap-2">
          <Bell className="h-3.5 w-3.5" /> {alertRuleCount} alert {alertRuleCount === 1 ? "rule" : "rules"}
        </span>
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}

export function TargetsTable({ targets }: { targets: OverviewTargetSnapshot[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--lp-border)] bg-[#0a0a0a]" aria-labelledby="targets-title">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 id="targets-title" className="text-md font-medium">
          Targets
        </h2>
        <Link href="/history" className="flex items-center gap-1 text-sm text-[var(--lp-muted)] hover:text-[var(--lp-text)]">
          History <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-[var(--lp-border)] text-left text-xs text-[var(--lp-subtle)]">
              <th className="px-5 py-2.5 font-medium">Target</th>
              <th className="px-3 py-2.5 font-medium">Type</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 text-right font-medium">Last RTT</th>
              <th className="px-5 py-2.5 text-right font-medium">Last seen</th>
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.id} className="border-b border-[var(--lp-border)] last:border-b-0 hover:bg-white/[0.02]">
                <td className="px-5 py-3">
                  <Link href={t.href} className="block max-w-[320px] truncate text-[var(--lp-text)] hover:text-[var(--lp-accent)]">
                    {t.host}
                    {t.port ? <span className="text-[var(--lp-subtle)]">:{t.port}</span> : null}
                  </Link>
                  {t.ruleName ? <span className="text-xs text-[var(--lp-subtle)]">{t.ruleName}</span> : null}
                </td>
                <td className="lp-mono px-3 py-3 text-xs text-[var(--lp-muted)]">{t.protocol === "tcpping" ? "TCP" : "ICMP"}</td>
                <td className="px-3 py-3">
                  <span className="inline-flex items-center gap-1.5 text-[var(--lp-muted)]">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: stateMeta[t.healthState].color }} />
                    {stateMeta[t.healthState].label}
                  </span>
                </td>
                <td className="lp-mono px-3 py-3 text-right">{formatMs(t.lastRttMs)}</td>
                <td className="px-5 py-3 text-right text-[var(--lp-subtle)]">{relativeTime(t.lastSampleAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function GettingStarted({ hasAlertRules }: { hasAlertRules: boolean }) {
  const steps = [
    {
      icon: Radar,
      title: "Run your first probe",
      body: "Use the bar above, or open a tool from the sidebar. Results show up here and in history.",
      href: "/tcp-ping",
      cta: "Open TCP ping",
      done: false,
    },
    {
      icon: Bell,
      title: "Add an alert rule",
      body: "Get an email when latency or packet loss crosses a threshold you choose.",
      href: "/alerts",
      cta: "Create a rule",
      done: hasAlertRules,
    },
    {
      icon: Users,
      title: "Invite your team",
      body: "Everyone in the workspace sees the same targets, history, and alerts.",
      href: "/workspace/team",
      cta: "Invite people",
      done: false,
    },
  ];
  return (
    <section className="rounded-xl border border-[var(--lp-border)] bg-[#0a0a0a]" aria-labelledby="start-title">
      <div className="border-b border-[var(--lp-border)] px-5 py-4">
        <h2 id="start-title" className="text-md font-medium">
          Get started
        </h2>
        <p className="mt-1 text-sm text-[var(--lp-muted)]">Nothing to show yet. These three steps fill this page in.</p>
      </div>
      <ol className="grid md:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className={cn("flex flex-col p-5", i > 0 && "border-t border-[var(--lp-border)] md:border-l md:border-t-0")}>
            <span className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--lp-border-strong)] bg-white/[0.03]">
              <step.icon className="h-4 w-4 text-[var(--lp-accent)]" />
            </span>
            <h3 className="mt-4 text-base font-medium">
              {step.title}
              {step.done ? <span className="ml-2 text-xs font-normal text-[var(--lp-green)]">Done</span> : null}
            </h3>
            <p className="mt-1.5 flex-1 text-sm leading-relaxed text-[var(--lp-muted)]">{step.body}</p>
            <Link href={step.href} className="mt-4 inline-flex items-center gap-1 text-sm text-[var(--lp-accent)] hover:text-[#ff7aa6]">
              {step.cta} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
