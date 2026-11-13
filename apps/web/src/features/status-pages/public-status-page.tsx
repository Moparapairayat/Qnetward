"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "@/components/icons";
import type { PublicStatusComponent, PublicStatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { QnetwardMark } from "@/features/landing/qnetward-mark";

const banner = {
  operational: { text: "All systems operational", icon: CheckCircle2, tone: "border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.08)] text-[#86efac]" },
  degraded: { text: "Some systems are having problems", icon: AlertTriangle, tone: "border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.08)] text-[#fcd34d]" },
  outage: { text: "Major outage", icon: XCircle, tone: "border-[rgba(255,92,92,0.35)] bg-[rgba(255,92,92,0.1)] text-[#ff9b9b]" },
  unknown: { text: "Waiting for the first checks", icon: CircleDashed, tone: "border-[var(--lp-border-strong)] bg-white/[0.03] text-[var(--lp-muted)]" },
} as const;

const componentStatus: Record<PublicStatusComponent["status"], { text: string; color: string }> = {
  up: { text: "Operational", color: "#86efac" },
  down: { text: "Down", color: "#ff9b9b" },
  pending: { text: "No data yet", color: "var(--lp-subtle)" },
  paused: { text: "Paused", color: "var(--lp-subtle)" },
};

/** The last `count` UTC days, oldest first, as YYYY-MM-DD. */
function lastDays(count: number, now: Date) {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function dayColor(checks: number, failed: number) {
  if (!checks) return "rgba(255,255,255,0.07)";
  const up = (checks - failed) / checks;
  if (up >= 0.999) return "#4ade80";
  if (up >= 0.99) return "#a3e635";
  if (up >= 0.95) return "#fbbf24";
  return "#ff5c5c";
}

function percent(checks: number, failed: number) {
  if (!checks) return null;
  const value = ((checks - failed) / checks) * 100;
  return value >= 99.995 ? "100%" : `${value.toFixed(2)}%`;
}

const dayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Component({ component, days }: { component: PublicStatusComponent; days: string[] }) {
  const byDate = new Map(component.days.map((d) => [d.date, d]));
  const totals = component.days.reduce((acc, d) => ({ checks: acc.checks + d.checks, failed: acc.failed + d.failed }), { checks: 0, failed: 0 });
  const state = componentStatus[component.status];
  const uptime = percent(totals.checks, totals.failed);
  return (
    <li className="px-5 py-5">
      <div className="flex items-center justify-between gap-4">
        <p className="min-w-0 truncate text-md font-medium">{component.name}</p>
        <p className="shrink-0 text-sm font-medium" style={{ color: state.color }}>
          {state.text}
        </p>
      </div>
      <div className="mt-3 flex h-8 gap-[3px]" role="img" aria-label={`${component.name}: ${uptime ?? "no"} uptime over ${days.length} days`}>
        {days.map((date) => {
          const d = byDate.get(date);
          const checks = d?.checks ?? 0;
          const failed = d?.failed ?? 0;
          return (
            <span
              key={date}
              className="h-full min-w-0 flex-1 rounded-[2px] transition-opacity hover:opacity-70"
              style={{ background: dayColor(checks, failed) }}
              title={checks ? `${dayLabel(date)}: ${percent(checks, failed)} uptime${failed ? `, ${failed} of ${checks.toLocaleString()} checks failed` : ""}` : `${dayLabel(date)}: no data`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-[var(--lp-subtle)]">
        <span>{days.length} days ago</span>
        <span className="text-[var(--lp-muted)]">{uptime ? `${uptime} uptime` : "No checks yet"}</span>
        <span>Today</span>
      </div>
    </li>
  );
}

/** A status page as the public sees it: one verdict up top, then each service's recent days. */
export function PublicStatusPage({ data: initial }: { data: PublicStatusResponse }) {
  const [data, setData] = useState(initial);
  const [live, setLive] = useState(false);
  // Read by the fallback poll without restarting the stream when it changes.
  const liveRef = useRef(false);
  const slug = initial.page.slug;

  // Live: the page listens for its own changes and reloads its data when one
  // happens, so a visitor sees an outage the moment it's recorded. The stream
  // says only "something changed"; the data comes from the public endpoint.
  // If the stream can't connect, the page checks once a minute instead.
  useEffect(() => {
    let stopped = false;
    const refresh = () =>
      fetch(`/api/public/status/${encodeURIComponent(slug)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: PublicStatusResponse | null) => {
          if (d && !stopped) setData(d);
        })
        .catch(() => {});
    const poll = window.setInterval(() => {
      if (!liveRef.current) void refresh();
    }, 60_000);
    let source: EventSource | null = null;
    if (typeof EventSource !== "undefined") {
      source = new EventSource(`/api/public/status/${encodeURIComponent(slug)}/events`);
      source.addEventListener("ready", () => {
        liveRef.current = true;
        setLive(true);
        void refresh(); // catch up on anything from before the stream opened
      });
      source.addEventListener("update", () => void refresh());
      source.addEventListener("gone", () => window.location.reload());
      source.onerror = () => {
        liveRef.current = false;
        setLive(false);
      };
    }
    return () => {
      stopped = true;
      window.clearInterval(poll);
      source?.close();
    };
  }, [slug]);

  const { page } = data;
  const verdict = banner[data.status] ?? banner.unknown;
  const updated = new Date(page.updated_at);
  const days = lastDays(data.days, updated);

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-12 sm:py-16">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] sm:text-2xl">{page.title}</h1>
        {page.description ? <p className="mt-2 max-w-xl text-md leading-relaxed text-[var(--lp-muted)]">{page.description}</p> : null}
      </header>

      <div className={cn("mt-8 flex items-center gap-3 rounded-xl border px-5 py-4", verdict.tone)}>
        <verdict.icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="flex-1 text-md font-medium">{verdict.text}</p>
        <p className="hidden items-center gap-1.5 text-xs opacity-80 sm:flex">
          {live ? (
            <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
          ) : null}
          {live ? "Live · " : "Updated "}
          {updated.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC
        </p>
      </div>

      {page.components.length ? (
        <section aria-label="Services" className="mt-6 rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f]">
          <ul className="divide-y divide-[var(--lp-border)]">
            {page.components.map((c, i) => (
              <Component key={`${i}-${c.name}`} component={c} days={days} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="mt-6 rounded-xl border border-dashed border-[var(--lp-border)] px-5 py-8 text-center text-base text-[var(--lp-subtle)]">No services on this page yet.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--lp-subtle)]">
        {[
          ["#4ade80", "No downtime"],
          ["#a3e635", "Under 1%"],
          ["#fbbf24", "Under 5%"],
          ["#ff5c5c", "5% or more"],
          ["rgba(255,255,255,0.12)", "No data"],
        ].map(([color, label]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>

      <footer className="mt-14 flex items-center justify-center">
        <Link href="/" className="inline-flex -my-1.5 py-1.5 items-center gap-2 text-xs text-[var(--lp-subtle)] hover:text-[var(--lp-text)]">
          <QnetwardMark size={16} /> Powered by Qnetward
        </Link>
      </footer>
    </div>
  );
}
