"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Clock,
  Download,
  Gauge,
  History,
  Play,
  Plus,
  RefreshCw,
  Search,
  Target,
  WifiOff,
  type AppIcon,
} from "@/components/icons";
import type { HistoryPoint, RuntimeHealthResponse } from "@/lib/types";
import type { OverviewTargetSnapshot } from "@/features/overview/overview-helpers";
import { cn } from "@/lib/utils";
import { LivePill, smoothPath, usePrefersReducedMotion } from "@/components/charts/live-signal-chart";

const SERIES_COLORS = ["#ff3d7f", "#22c3d6", "#a78bfa", "#4ade80"];

const stateMeta: Record<OverviewTargetSnapshot["healthState"], { label: string; color: string; pill: string }> = {
  critical: { label: "Down", color: "#ff3d7f", pill: "border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.1)] text-[#ff8fb3]" },
  warning: { label: "Degraded", color: "#fbbf24", pill: "border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.1)] text-[#fcd34d]" },
  stable: { label: "Healthy", color: "#4ade80", pill: "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]" },
  idle: { label: "No data", color: "#85858e", pill: "border-[var(--lp-border)] bg-white/[0.03] text-[var(--lp-muted)]" },
  disabled: { label: "Paused", color: "#85858e", pill: "border-[var(--lp-border)] bg-white/[0.03] text-[var(--lp-muted)]" },
};

export function formatMs(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return value >= 100 ? `${Math.round(value)}` : value.toFixed(1);
}

function relativeTime(ts?: number | null) {
  if (!ts) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function clockTime(ts: number) {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Current time, refreshed every 10 seconds, so "streaming now" counts stay pure during render. */
export function useNow(intervalMs = 10_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/* ---------------------------------------------------------------- header */

export function WelcomeHeader({
  name,
  targets,
  health,
  onRefresh,
  refreshing,
}: {
  name?: string | null;
  targets: OverviewTargetSnapshot[];
  health?: RuntimeHealthResponse;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const deps = health ? [health.database, health.redis, health.object_storage].filter((d) => d.enabled) : [];
  const degraded = health?.ok === false || deps.some((d) => !d.healthy);
  const serviceLabel = !health ? "Checking services" : degraded ? "Service degraded" : "Services healthy";
  const serviceColor = !health ? "#85858e" : degraded ? "#fbbf24" : "#4ade80";
  const first = (name ?? "").trim().split(/\s+/)[0];
  const withData = targets.filter((t) => t.healthState !== "idle" && t.healthState !== "disabled");
  const healthy = withData.filter((t) => t.healthState === "stable").length;
  const pct = withData.length ? Math.round((healthy / withData.length) * 1000) / 10 : null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 className="text-[24px] font-medium tracking-[-0.02em]">
          Welcome back{first ? ", " : ""}
          {first ? <span className="text-[var(--lp-accent)]">{first}</span> : null}
        </h1>
        <p className="mt-1 text-[14px] text-[var(--lp-muted)]">
          {pct === null ? (
            "No probe results yet. Run one to start filling this page."
          ) : (
            <>
              <span className="text-[var(--lp-accent)]">{pct}%</span> of {withData.length} {withData.length === 1 ? "target is" : "targets are"} healthy right now.
            </>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/status"
          className="mr-1 hidden items-center gap-2 text-[12px] text-[var(--lp-muted)] hover:text-[var(--lp-text)] sm:flex"
          title="Database, cache, and object storage status"
        >
          <span className="h-2 w-2 rounded-full" style={{ background: serviceColor }} />
          {serviceLabel}
        </Link>
        <Link href="/tcp-ping" className="console-btn border border-[rgba(255,61,127,0.4)] bg-[rgba(255,61,127,0.08)] text-[#ff8fb3] hover:bg-[rgba(255,61,127,0.14)]">
          <Plus className="h-3.5 w-3.5" /> New probe
        </Link>
        <Link href="/alerts" className="console-btn console-btn-secondary">
          <AlertTriangle className="h-3.5 w-3.5" /> View alerts
        </Link>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh"
          className="console-btn console-btn-secondary w-8 px-0"
          disabled={refreshing}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- sparkline */

/** Small trend line. Nulls are failures: they break the line and leave a tick on the floor. */
function Sparkline({ values, color, height = 28, className }: { values: (number | null)[]; color: string; height?: number; className?: string }) {
  const id = useId();
  const W = 120;
  const H = height;
  const nums = values.filter((v): v is number => typeof v === "number");
  const n = Math.max(1, values.length - 1);
  const px = (i: number) => (i / n) * (W - 4) + 2;
  if (nums.length < 2) {
    if (!values.some((v) => v === null)) return <span className={cn("block", className)} style={{ height }} aria-hidden="true" />;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className={cn("block", className)} style={{ height }} preserveAspectRatio="none" aria-hidden="true">
        <line x1="2" x2={W - 2} y1={H - 1} y2={H - 1} stroke="rgba(255,255,255,0.08)" vectorEffect="non-scaling-stroke" />
        {values.map((v, i) => (v === null ? <line key={i} x1={px(i)} x2={px(i)} y1={H - 7} y2={H} stroke="#ff3d7f" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /> : null))}
      </svg>
    );
  }
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const span = Math.max(1e-6, hi - lo);
  const py = (v: number) => H - 3 - ((v - lo) / span) * (H - 6);
  const runs: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  values.forEach((v, i) => {
    if (typeof v === "number") run.push({ x: px(i), y: py(v) });
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);
  const line = runs.map((r) => smoothPath(r)).join(" ");
  const area = runs
    .filter((r) => r.length > 1)
    .map((r) => `${smoothPath(r)} L${r[r.length - 1].x.toFixed(1)},${H} L${r[0].x.toFixed(1)},${H} Z`)
    .join(" ");
  const lastIdx = values.length - 1 - [...values].reverse().findIndex((v) => typeof v === "number");
  const lastVal = values[lastIdx] as number;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("block", className)} style={{ height }} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {values.map((v, i) => (v === null ? <line key={i} x1={px(i)} x2={px(i)} y1={H - 4} y2={H} stroke="#ff3d7f" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /> : null))}
      <circle cx={px(lastIdx)} cy={py(lastVal)} r="2" fill={color} />
    </svg>
  );
}

/** Every stored sample across targets, oldest first. */
function samplesInOrder(historyMap: Map<string, HistoryPoint[]>) {
  return Array.from(historyMap.values())
    .flat()
    .sort((a, b) => a.ts - b.ts);
}

/* ----------------------------------------------------------------- stats */

type Stat = {
  icon: AppIcon;
  label: string;
  value: string;
  unit?: string;
  footer: string;
  tone?: "good" | "warn" | "bad";
  badge?: string;
  spark?: { values: (number | null)[]; color: string };
  split?: { value: number; color: string; label: string }[];
};

function StatCard({ stat }: { stat: Stat }) {
  const toneClass =
    stat.tone === "good"
      ? "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]"
      : stat.tone === "warn"
        ? "border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.08)] text-[#fcd34d]"
        : stat.tone === "bad"
          ? "border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] text-[#ff8fb3]"
          : "";
  return (
    <div className="flex flex-col rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f]">
      <div className="flex items-center gap-2.5 px-4 pt-4">
        <span className="grid h-7 w-7 place-items-center rounded-md border border-[var(--lp-border-strong)] bg-white/[0.03]">
          <stat.icon className="h-4 w-4 text-[var(--lp-muted)]" />
        </span>
        <span className="text-[13px] text-[var(--lp-text)]">{stat.label}</span>
      </div>
      <div className="flex items-end justify-between gap-3 px-4 pb-3 pt-2">
        <span className="flex items-baseline gap-1.5">
          <span className="text-[28px] font-medium tracking-[-0.02em]">{stat.value}</span>
          {stat.unit ? <span className="text-[13px] text-[var(--lp-subtle)]">{stat.unit}</span> : null}
        </span>
        {stat.spark ? <Sparkline values={stat.spark.values} color={stat.spark.color} className="mb-1 w-[46%] max-w-[120px]" /> : null}
        {stat.split && stat.split.some((part) => part.value > 0) ? (
          <span
            className="mb-2 flex h-1.5 w-[46%] max-w-[120px] gap-[2px] overflow-hidden rounded-full"
            title={stat.split.map((part) => `${part.value} ${part.label}`).join(" · ")}
          >
            {stat.split
              .filter((part) => part.value > 0)
              .map((part) => (
                <span key={part.label} className="h-full rounded-full" style={{ flex: part.value, background: part.color }} />
              ))}
          </span>
        ) : null}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-[var(--lp-border)] px-4 py-2 text-[12px] text-[var(--lp-subtle)]">
        <span className="truncate">{stat.footer}</span>
        {stat.tone ? (
          <span className={cn("rounded border px-1.5 py-px text-[11px]", toneClass)}>
            {stat.badge ?? (stat.tone === "good" ? "OK" : stat.tone === "warn" ? "Watch" : "High")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function StatCards({
  targets,
  historyMap,
  alertRuleCount,
  firingCount,
}: {
  targets: OverviewTargetSnapshot[];
  historyMap: Map<string, HistoryPoint[]>;
  alertRuleCount: number;
  firingCount: number;
}) {
  const now = useNow();
  const stats = useMemo<Stat[]>(() => {
    const points = samplesInOrder(historyMap);
    const recent = points.slice(-48);
    // Loss across the same samples the headline figure counts, grouped into up
    // to 40 buckets so the line stays readable and always agrees with the number.
    const buckets = Math.min(40, points.length);
    const lossTrend = Array.from({ length: buckets }, (_, i) => {
      const slice = points.slice(Math.floor((i * points.length) / buckets), Math.floor(((i + 1) * points.length) / buckets));
      return slice.length ? (slice.filter((p) => p.error || typeof p.rtt_ms !== "number").length / slice.length) * 100 : 0;
    });
    const rtts = points.map((p) => p.rtt_ms).filter((v): v is number => typeof v === "number");
    const avg = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null;
    const failures = points.filter((p) => p.error || typeof p.rtt_ms !== "number").length;
    const loss = points.length ? (failures / points.length) * 100 : null;
    const live = targets.filter((t) => t.lastSampleAt && now - t.lastSampleAt < 15_000).length;
    return [
      {
        icon: Target,
        label: "Targets",
        value: String(targets.length),
        unit: targets.length === 1 ? "target" : "targets",
        footer: live ? `${live} streaming now` : "From recent probes and alert rules",
        split: (["stable", "warning", "critical", "idle"] as const).map((state) => ({
          value: targets.filter((t) => t.healthState === state).length,
          color: stateMeta[state].color,
          label: stateMeta[state].label.toLowerCase(),
        })),
      },
      {
        icon: Gauge,
        label: "Average latency",
        value: formatMs(avg),
        unit: avg === null ? undefined : "ms",
        footer: rtts.length ? `Across ${rtts.length} recent replies` : "No replies yet",
        tone: avg === null ? undefined : avg < 100 ? "good" : avg < 250 ? "warn" : "bad",
        spark: { values: recent.map((p) => (typeof p.rtt_ms === "number" ? p.rtt_ms : null)), color: "#ff3d7f" },
      },
      {
        icon: WifiOff,
        label: "Packet loss",
        value: loss === null ? "—" : loss.toFixed(loss < 10 ? 1 : 0),
        unit: loss === null ? undefined : "%",
        footer: points.length ? `${failures} of ${points.length} probes failed` : "No probes yet",
        tone: loss === null ? undefined : loss < 1 ? "good" : loss < 5 ? "warn" : "bad",
        // Always drawn: a flat green line means no loss, rather than a missing chart.
        spark: lossTrend.length > 1 ? { values: lossTrend, color: lossTrend.some((v) => v > 0) ? "#fbbf24" : "#4ade80" } : undefined,
      },
      {
        icon: Bell,
        label: "Alert rules",
        value: String(alertRuleCount),
        unit: alertRuleCount === 1 ? "rule" : "rules",
        footer: firingCount ? `${firingCount} currently firing` : alertRuleCount ? "None firing" : "No rules yet",
        tone: alertRuleCount ? (firingCount ? "bad" : "good") : undefined,
        badge: alertRuleCount ? (firingCount ? "Firing" : "Quiet") : undefined,
      },
    ];
  }, [alertRuleCount, firingCount, historyMap, now, targets]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4">
      {stats.map((stat) => (
        <StatCard key={stat.label} stat={stat} />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- latency chart */

type Series = { id: string; label: string; color: string; points: { ts: number; rtt: number }[] };

/** Tracks an element's rendered size so charts can draw in real pixels instead of a stretched viewBox. */
export function useElementSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

export function ResponseTimeChart({ targets, historyMap }: { targets: OverviewTargetSnapshot[]; historyMap: Map<string, HistoryPoint[]> }) {
  const [boxRef, box] = useElementSize();
  const [hoverTs, setHoverTs] = useState<number | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const now = useNow(2_000);
  const reducedMotion = usePrefersReducedMotion();

  const allSeries = useMemo<Series[]>(() => {
    return targets
      .map((t) => ({
        id: t.id,
        label: t.name,
        points: (historyMap.get(t.id) ?? [])
          .filter((p): p is HistoryPoint & { rtt_ms: number } => typeof p.rtt_ms === "number")
          .map((p) => ({ ts: p.ts, rtt: p.rtt_ms }))
          .sort((a, b) => a.ts - b.ts),
      }))
      .filter((s) => s.points.length > 1)
      .slice(0, SERIES_COLORS.length)
      .map((s, i) => ({ ...s, color: SERIES_COLORS[i] }));
  }, [historyMap, targets]);
  const series = useMemo(() => allSeries.filter((s) => !hidden.includes(s.id)), [allSeries, hidden]);

  const W = Math.max(box.width, 1);
  const H = Math.max(box.height, 1);
  const PAD = { l: 44, r: 16, t: 10, b: 24 };
  const all = series.flatMap((s) => s.points);

  // Collapse long idle gaps on the time axis so bursts of probes stay readable.
  const axis = useMemo(() => {
    const times = Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.ts)))).sort((a, b) => a - b);
    const deltas = times.slice(1).map((t, idx) => t - times[idx]).sort((a, b) => a - b);
    const typical = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 1;
    const cap = Math.max(typical * 3, 1);
    const threshold = Math.max(60_000, typical * 10);
    const eff: number[] = [];
    const breaks: number[] = [];
    times.forEach((t, idx) => {
      if (idx === 0) return eff.push(0);
      const delta = t - times[idx - 1];
      if (delta > threshold) breaks.push(idx);
      eff.push(eff[idx - 1] + Math.min(delta, delta > threshold ? cap : delta));
    });
    return { times, eff, breaks };
  }, [series]);

  const toEff = (ts: number) => {
    const { times, eff } = axis;
    if (!times.length) return 0;
    if (ts <= times[0]) return 0;
    for (let k = 1; k < times.length; k++) {
      if (ts <= times[k]) return eff[k - 1] + ((ts - times[k - 1]) / Math.max(1, times[k] - times[k - 1])) * (eff[k] - eff[k - 1]);
    }
    return eff[eff.length - 1];
  };
  const fromEff = (e: number) => {
    const { times, eff } = axis;
    if (!times.length) return 0;
    for (let k = 1; k < eff.length; k++) {
      if (e <= eff[k]) return times[k - 1] + ((e - eff[k - 1]) / Math.max(1e-9, eff[k] - eff[k - 1])) * (times[k] - times[k - 1]);
    }
    return times[times.length - 1];
  };
  const maxEff = Math.max(1, axis.eff[axis.eff.length - 1] ?? 1);
  const maxRtt = all.length ? Math.max(...all.map((p) => p.rtt)) : 1;
  const minRtt = all.length ? Math.min(...all.map((p) => p.rtt)) : 0;
  const span = Math.max(1, maxRtt - minRtt);
  const yMin = Math.max(0, minRtt - span * 0.15);
  const yMax = maxRtt + span * 0.15;
  const plotW = Math.max(1, W - PAD.l - PAD.r);
  const x = (ts: number) => PAD.l + (toEff(ts) / maxEff) * plotW;
  const y = (rtt: number) => PAD.t + (1 - (rtt - yMin) / Math.max(1, yMax - yMin)) * Math.max(1, H - PAD.t - PAD.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + (yMax - yMin) * f);

  // Break a line where a target stopped probing, instead of bridging the silence with a straight segment.
  const breakTimes = axis.breaks.map((k) => axis.times[k]);
  const linePath = (points: Series["points"]) => {
    const deltas = points.slice(1).map((p, idx) => p.ts - points[idx].ts).sort((a, b) => a - b);
    const typical = deltas.length ? deltas[Math.floor(deltas.length / 2)] : 0;
    const gap = Math.max(15_000, typical * 5);
    const runs: Series["points"][] = [];
    points.forEach((p, idx) => {
      const prev = points[idx - 1];
      const crossesBreak = prev && breakTimes.some((t) => t > prev.ts && t <= p.ts);
      if (idx === 0 || p.ts - prev.ts > gap || crossesBreak) runs.push([]);
      runs[runs.length - 1].push(p);
    });
    return runs.map((run) => smoothPath(run.map((p) => ({ x: x(p.ts), y: y(p.rtt) })))).join(" ");
  };

  // Time labels at the start of each burst of probes, skipped where they would collide.
  const timeLabels = useMemo(() => {
    const { times, breaks } = axis;
    if (!times.length || box.width === 0) return [];
    const rangeMs = times[times.length - 1] - times[0];
    const fmt = (ts: number) =>
      new Date(ts).toLocaleString([], rangeMs > 20 * 3_600_000 ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
    const candidates = [times[0], ...breaks.map((k) => times[k])];
    // Labels are 11px; ~6.5px per character is a safe width estimate. The first
    // label is anchored at its start, the rest at their middle.
    const width = (label: string) => label.length * 6.5;
    const out: { ts: number; label: string }[] = [];
    let lastRight = -Infinity;
    candidates.forEach((ts, i) => {
      const label = fmt(ts);
      const px = x(ts);
      const left = i === 0 ? px : px - width(label) / 2;
      if (left - lastRight < 16) return;
      out.push({ ts, label });
      lastRight = left + width(label);
    });
    return out;
    // x depends on axis and width only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis, box.width]);

  // A series counts as live while samples keep arriving; its newest point gets a pulsing head.
  const LIVE_WINDOW = 20_000;
  const lastSampleAt = all.length ? Math.max(...all.map((p) => p.ts)) : null;
  const anyLive = lastSampleAt !== null && now - lastSampleAt < LIVE_WINDOW;

  const nearest = (s: Series, ts: number) => s.points.reduce((best, p) => (Math.abs(p.ts - ts) < Math.abs(best.ts - ts) ? p : best), s.points[0]);

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!all.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const e = Math.min(maxEff, Math.max(0, ((px - PAD.l) / plotW) * maxEff));
    setHoverTs(fromEff(e));
  };

  const tooltipLeft = hoverTs !== null ? x(hoverTs) : 0;
  // Only series that actually have data around the hovered time, so the tooltip never borrows a far-away value.
  const covering = hoverTs === null ? [] : series.filter((s) => hoverTs >= s.points[0].ts && hoverTs <= s.points[s.points.length - 1].ts);
  const dim = (id: string) => focusId !== null && focusId !== id;

  return (
    <section className="flex flex-col rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f]" aria-labelledby="rt-title">
      <div className="flex flex-wrap items-center gap-3 px-4 pt-4">
        <span className="grid h-7 w-7 place-items-center rounded-md border border-[var(--lp-border-strong)] bg-white/[0.03]">
          <Clock className="h-3.5 w-3.5 text-[var(--lp-muted)]" />
        </span>
        <h2 id="rt-title" className="text-[14px] font-medium">
          Response time
        </h2>
        <span className="ml-auto flex items-center gap-3">
          {anyLive ? (
            <LivePill live updatedAt={lastSampleAt} />
          ) : (
            <Link href="/monitors" className="text-[12px] text-[var(--lp-subtle)] hover:text-[var(--lp-text)]">
              Add a monitor for a live line
            </Link>
          )}
        </span>
      </div>
      {allSeries.length ? (
        <>
          <ul className="flex flex-wrap gap-1.5 px-4 pt-3 text-[12px]" aria-label="Series">
            {allSeries.map((s) => {
              const off = hidden.includes(s.id);
              const last = s.points[s.points.length - 1];
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-pressed={!off}
                    title={off ? `Show ${s.label}` : `Hide ${s.label}`}
                    onClick={() => setHidden((h) => (h.includes(s.id) ? h.filter((v) => v !== s.id) : [...h, s.id]))}
                    onMouseEnter={() => !off && setFocusId(s.id)}
                    onMouseLeave={() => setFocusId(null)}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-2 py-1 transition-colors",
                      off ? "border-transparent text-[var(--lp-subtle)] line-through" : "border-[var(--lp-border)] text-[var(--lp-muted)] hover:border-[var(--lp-border-strong)] hover:text-[var(--lp-text)]",
                    )}
                  >
                    <span className="h-2.5 w-[3px] rounded-full" style={{ background: off ? "rgba(255,255,255,0.15)" : s.color }} />
                    <span className="max-w-[160px] truncate">{s.label}</span>
                    {!off ? <span className="lp-mono text-[11px] text-[var(--lp-subtle)]">{formatMs(last.rtt)}ms</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div ref={boxRef} className="relative mx-2 mb-2 mt-2 min-h-[210px] flex-1">
            {box.width > 0 && series.length ? (
              <svg width={W} height={H} className="absolute inset-0 touch-none" onPointerMove={onMove} onPointerLeave={() => setHoverTs(null)} role="img" aria-label="Response time per target">
                {axis.breaks.map((k) => {
                  const x0 = x(axis.times[k - 1]) + 5;
                  const x1 = x(axis.times[k]) - 5;
                  const idleMin = Math.round((axis.times[k] - axis.times[k - 1]) / 60_000);
                  return x1 > x0 ? (
                    <rect key={k} x={x0} y={PAD.t} width={x1 - x0} height={H - PAD.t - PAD.b} fill="rgba(255,255,255,0.025)" rx="2">
                      <title>{idleMin >= 60 ? `${Math.round(idleMin / 60)}h` : `${idleMin}m`} without samples</title>
                    </rect>
                  ) : null;
                })}
                {ticks.map((v) => (
                  <g key={v}>
                    <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.05)" />
                    <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#85858e">
                      {Math.round(v)}ms
                    </text>
                  </g>
                ))}
                {timeLabels.map((tl, i) => (
                  <text key={tl.ts} x={x(tl.ts)} y={H - 6} textAnchor={i === 0 ? "start" : "middle"} fontSize="11" fill="#85858e">
                    {tl.label}
                  </text>
                ))}
                {series.map((s) => (
                  <path
                    key={s.id}
                    d={linePath(s.points)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={focusId === s.id ? 2.2 : 1.6}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={dim(s.id) ? 0.18 : 1}
                    style={{ transition: "opacity 150ms ease" }}
                  />
                ))}
                {series.map((s) => {
                  const head = s.points[s.points.length - 1];
                  const live = now - head.ts < LIVE_WINDOW;
                  const hx = x(head.ts);
                  const hy = y(head.rtt);
                  return (
                    <g key={`head-${s.id}`} pointerEvents="none" opacity={dim(s.id) ? 0.18 : 1}>
                      {live && !reducedMotion ? <circle cx={hx} cy={hy} r="9" fill={s.color} opacity="0.35" className="lp-map-ping" /> : null}
                      <circle cx={hx} cy={hy} r={live ? 3.5 : 2.75} fill={live ? s.color : "#1b1b1f"} stroke={s.color} strokeWidth="1.5" />
                    </g>
                  );
                })}
                {hoverTs !== null ? (
                  <>
                    <line x1={x(hoverTs)} x2={x(hoverTs)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />
                    {covering.map((s) => {
                      const p = nearest(s, hoverTs);
                      return <circle key={s.id} cx={x(p.ts)} cy={y(p.rtt)} r="3.5" fill={s.color} stroke="#1b1b1f" strokeWidth="1.5" />;
                    })}
                  </>
                ) : null}
              </svg>
            ) : null}
            {box.width > 0 && !series.length ? (
              <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[var(--lp-subtle)]">All series are hidden. Pick one above.</div>
            ) : null}
            {hoverTs !== null && covering.length ? (
              <div
                className="console-popover pointer-events-none absolute top-4 z-10 w-56 p-3 text-[12px]"
                style={{ left: Math.min(Math.max(8, tooltipLeft + 12), Math.max(8, W - 232)) }}
              >
                <div className="mb-2 text-[var(--lp-subtle)]">{clockTime(hoverTs)}</div>
                <ul className="space-y-1.5">
                  {covering.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <span className="h-2.5 w-[3px] rounded-full" style={{ background: s.color }} />
                      <span className="min-w-0 flex-1 truncate text-[var(--lp-muted)]">{s.label}</span>
                      <span className="lp-mono text-[var(--lp-text)]">
                        {formatMs(nearest(s, hoverTs).rtt)} <span className="text-[var(--lp-subtle)]">ms</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="m-4 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-[var(--lp-border)] py-16 text-center">
          <Activity className="h-5 w-5 text-[var(--lp-subtle)]" />
          <p className="mt-3 text-[13px] text-[var(--lp-muted)]">No latency data yet</p>
          <p className="mt-1 text-[12px] text-[var(--lp-subtle)]">Add a monitor and it draws a live line here, checked every 30 seconds or more.</p>
          <Link href="/monitors" className="console-btn console-btn-secondary mt-4">
            <Plus className="h-3.5 w-3.5" /> Add a monitor
          </Link>
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------- status card */

function SegmentBar({ value, color }: { value: number; color: string }) {
  const segments = 28;
  const filled = Math.round((value / 100) * segments);
  return (
    <div className="flex gap-[3px]" aria-hidden="true">
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className="h-3.5 flex-1 rounded-[2px]" style={{ background: i < filled ? color : "rgba(255,255,255,0.07)" }} />
      ))}
    </div>
  );
}

export function TargetHealthCard({ targets }: { targets: OverviewTargetSnapshot[] }) {
  const total = targets.length;
  const rows: { state: OverviewTargetSnapshot["healthState"]; label: string }[] = [
    { state: "stable", label: "Healthy" },
    { state: "warning", label: "Degraded" },
    { state: "critical", label: "Down" },
    { state: "idle", label: "No recent data" },
  ];
  const attention = targets.filter((t) => t.healthState === "critical" || t.healthState === "warning");

  return (
    <section className="flex flex-col rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f]" aria-labelledby="health-title">
      <div className="flex items-center gap-3 px-4 pt-4">
        <span className="grid h-7 w-7 place-items-center rounded-md border border-[var(--lp-border-strong)] bg-white/[0.03]">
          <Activity className="h-3.5 w-3.5 text-[var(--lp-muted)]" />
        </span>
        <h2 id="health-title" className="text-[14px] font-medium">
          Target health
        </h2>
      </div>
      <div className="space-y-3 px-4 pb-4 pt-3.5">
        {rows.map((row) => {
          const count = targets.filter((t) => t.healthState === row.state).length;
          const pct = total ? Math.round((count / total) * 100) : 0;
          return (
            <div key={row.state}>
              <div className="mb-1 flex items-baseline justify-between text-[13px]">
                <span className="text-[var(--lp-text)]">{row.label}</span>
                <span className="lp-mono text-[12px]" style={{ color: count ? stateMeta[row.state].color : "var(--lp-subtle)" }}>
                  {count} <span className="text-[var(--lp-subtle)]">· {pct}%</span>
                </span>
              </div>
              <SegmentBar value={pct} color={stateMeta[row.state].color} />
            </div>
          );
        })}
      </div>
      {/* Only takes room when something needs a look, or before the first probe. */}
      {attention.length ? (
        <div className="mx-4 mb-4 rounded-lg border border-[var(--lp-border)] bg-black/20 p-3">
          <p className="flex items-center gap-2 text-[12px] text-[var(--lp-muted)]">
            <AlertTriangle className="h-3.5 w-3.5 text-[var(--lp-amber)]" />
            {attention.length} {attention.length === 1 ? "target needs" : "targets need"} attention
          </p>
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {attention.slice(0, 3).map((t) => (
              <li key={t.id}>
                <Link href={t.href} className="flex items-center gap-2 text-[var(--lp-text)] hover:text-[var(--lp-accent)]">
                  <span className="h-1.5 w-1.5 rounded-sm" style={{ background: stateMeta[t.healthState].color }} />
                  <span className="truncate">{t.name}</span>
                  <span className="ml-auto text-[var(--lp-subtle)]">{stateMeta[t.healthState].label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : !total ? (
        <p className="px-4 pb-4 text-[12px] text-[var(--lp-subtle)]">Targets appear here after your first probe.</p>
      ) : null}
    </section>
  );
}

/* ----------------------------------------------------------- targets table */

type StatusFilter = "all" | "stable" | "warning" | "critical" | "idle";
type TypeFilter = "all" | "ping" | "tcpping";

function historyHref(t: OverviewTargetSnapshot) {
  const params = new URLSearchParams({ type: t.protocol, host: t.host, limit: "120" });
  if (t.protocol === "tcpping" && t.port) params.set("port", String(t.port));
  return `/history?${params.toString()}`;
}

export function TargetsSummary({ targets, historyMap }: { targets: OverviewTargetSnapshot[]; historyMap: Map<string, HistoryPoint[]> }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");

  const rows = targets.filter(
    (t) =>
      (status === "all" || t.healthState === status) &&
      (type === "all" || t.protocol === type) &&
      (!query.trim() || t.name.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f]" aria-labelledby="summary-title">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <h2 id="summary-title" className="mr-auto text-[14px] font-medium">
          Targets
        </h2>
        <label className="relative">
          <span className="sr-only">Search targets</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--lp-subtle)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-8 w-40 pl-8 pr-2 text-[13px]"
          />
        </label>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="h-8 px-2 text-[13px]">
          <option value="all">All statuses</option>
          <option value="stable">Healthy</option>
          <option value="warning">Degraded</option>
          <option value="critical">Down</option>
          <option value="idle">No data</option>
        </select>
        <select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value as TypeFilter)} className="h-8 px-2 text-[13px]">
          <option value="all">All types</option>
          <option value="ping">ICMP</option>
          <option value="tcpping">TCP</option>
        </select>
        <Link href="/history" aria-label="Export from history" className="console-btn console-btn-secondary h-8 w-8 px-0">
          <Download className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="border-y border-[var(--lp-border)] bg-white/[0.015] text-left text-[12px] text-[var(--lp-subtle)]">
              <th className="px-4 py-2.5 font-medium">Target</th>
              <th className="px-3 py-2.5 font-medium">Type</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Trend</th>
              <th className="px-3 py-2.5 text-right font-medium">Last RTT</th>
              <th className="px-3 py-2.5 text-right font-medium">Last seen</th>
              <th className="w-[84px] px-4 py-2.5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((t) => (
                <tr key={t.id} className="group border-b border-[var(--lp-border)] last:border-b-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <Link href={t.href} className="text-[var(--lp-text)] hover:text-[var(--lp-accent)]">
                      {t.name}
                    </Link>
                  </td>
                  <td className="lp-mono px-3 py-3 text-[12px] text-[var(--lp-muted)]">{t.protocol === "tcpping" ? "TCP" : "ICMP"}</td>
                  <td className="px-3 py-3">
                    <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-[12px]", stateMeta[t.healthState].pill)}>
                      {stateMeta[t.healthState].label}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-2.5">
                      <Sparkline
                        values={[...(historyMap.get(t.id) ?? [])].sort((a, b) => a.ts - b.ts).slice(-24).map((p) => (typeof p.rtt_ms === "number" ? p.rtt_ms : null))}
                        color={stateMeta[t.healthState].color}
                        height={22}
                        className="w-[96px]"
                      />
                      <span className="lp-mono text-[11px] text-[var(--lp-subtle)]" title={`${t.pointCount} samples`}>
                        {t.pointCount}
                      </span>
                    </span>
                  </td>
                  <td className="lp-mono px-3 py-3 text-right">
                    {formatMs(t.lastRttMs)}
                    {typeof t.lastRttMs === "number" ? <span className="text-[var(--lp-subtle)]"> ms</span> : null}
                  </td>
                  <td className="px-3 py-3 text-right text-[var(--lp-subtle)]">{relativeTime(t.lastSampleAt)}</td>
                  <td className="px-4 py-3">
                    <span className="flex justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <Link href={historyHref(t)} aria-label={`History for ${t.name}`} title="History" className="grid h-7 w-7 place-items-center rounded-md text-[var(--lp-muted)] hover:bg-white/[0.06] hover:text-[var(--lp-text)]">
                        <History className="h-3.5 w-3.5" />
                      </Link>
                      <Link href={t.href} aria-label={`Probe ${t.name} again`} title="Probe again" className="grid h-7 w-7 place-items-center rounded-md text-[var(--lp-muted)] hover:bg-white/[0.06] hover:text-[var(--lp-text)]">
                        <Play className="h-3.5 w-3.5" />
                      </Link>
                    </span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-[var(--lp-subtle)]">
                  {targets.length ? "No targets match these filters." : "No targets yet. Run a probe and it will show up here."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ coming next */

const upcoming = [
  { href: "/topology", title: "Topology", body: "A live map of your network built from LLDP and CDP.", phase: 3 },
  { href: "/attack-surface", title: "Attack surface", body: "Subdomains, open services, and certificates you didn't know about.", phase: 4 },
  { href: "/assistant", title: "AI assistant", body: "Ask about outages in plain language and get likely causes.", phase: 5 },
];

export function ComingNext() {
  return (
    <section aria-labelledby="next-title">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="next-title" className="text-[14px] font-medium">
          Coming next
        </h2>
        <span className="text-[12px] text-[var(--lp-subtle)]">Previews with sample data</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {upcoming.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-4 transition-colors hover:border-[var(--lp-border-strong)] hover:bg-[#202025]"
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium">{item.title}</span>
              <span className="rounded border border-[var(--lp-border)] px-1.5 text-[10px] leading-4 text-[var(--lp-subtle)]">Phase {item.phase}</span>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--lp-muted)]">{item.body}</p>
            <span className="mt-3 inline-block text-[12px] text-[var(--lp-accent)] opacity-80 group-hover:opacity-100">See preview →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
