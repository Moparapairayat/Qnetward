"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Clock } from "lucide-react";
import { apiRequest } from "@/lib/api";
import type { MonitorSeries, MonitorSeriesResponse, MonitorSeriesWindow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LivePill, smoothPath, usePrefersReducedMotion } from "@/components/charts/live-signal-chart";
import { clockTime, formatMs, useElementSize, useNow } from "@/features/overview/overview-dashboard";
import { useLiveInterval } from "@/lib/live";

const COLORS = ["#ff3d7f", "#22c3d6", "#a78bfa", "#4ade80", "#fbbf24", "#60a5fa", "#f472b6", "#2dd4bf"];
const DOWN = "#ff5c5c";
const WINDOWS: { id: MonitorSeriesWindow; label: string; tick: number }[] = [
  { id: "15m", label: "15m", tick: 3 * 60_000 },
  { id: "1h", label: "1h", tick: 10 * 60_000 },
  { id: "6h", label: "6h", tick: 60 * 60_000 },
  { id: "24h", label: "24h", tick: 4 * 60 * 60_000 },
];
const PAD = { l: 48, r: 16, t: 10, b: 26 };

type Point = { ts: number; rtt: number | null; failed: number; checks: number };
type Line = { id: number; label: string; color: string; status: MonitorSeries["status"]; enabled: boolean; slotMs: number; points: Point[] };

/** A round axis maximum: four steps of 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(value: number) {
  const raw = Math.max(value * 1.15, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  return step * 4;
}

function axisMs(v: number) {
  if (v >= 1000) return `${+(v / 1000).toFixed(2)}s`;
  return `${+v.toFixed(v < 10 ? 1 : 0)}ms`;
}

/**
 * Response time for every monitor over a sliding window. Monitors check on a
 * schedule, so the lines keep moving on their own: the axis slides every
 * second and new checks are fetched every few seconds. Without monitors it
 * shows `fallback`, the chart of hand-run probes.
 */
export function MonitorResponseChart({ enabled, fallback }: { enabled: boolean; fallback: ReactNode }) {
  const [win, setWin] = useState<MonitorSeriesWindow>("15m");
  const [boxRef, box] = useElementSize();
  const [hoverTs, setHoverTs] = useState<number | null>(null);
  const [hidden, setHidden] = useState<number[]>([]);
  const [focusId, setFocusId] = useState<number | null>(null);
  const now = useNow(1_000);
  const reducedMotion = usePrefersReducedMotion();

  const liveInterval = useLiveInterval(5_000);
  const query = useQuery({
    queryKey: ["monitor-series", win],
    queryFn: () => apiRequest<MonitorSeriesResponse>(`/api/monitors/series?window=${win}`),
    enabled,
    refetchInterval: liveInterval,
    placeholderData: (previous) => previous,
  });
  const data = query.data;
  const windowMeta = WINDOWS.find((w) => w.id === win) ?? WINDOWS[1];

  const lines = useMemo<Line[]>(() => {
    if (!data) return [];
    const bucketMs = data.bucket_seconds * 1000;
    // A bucket's value is drawn at its middle; a raw check at its own time.
    const offset = bucketMs > 1000 ? bucketMs / 2 : 0;
    return data.monitors.slice(0, COLORS.length).map((m, i) => ({
      id: m.id,
      label: m.name,
      color: COLORS[i],
      status: m.status,
      enabled: m.enabled,
      slotMs: Math.max(m.interval_seconds * 1000, bucketMs),
      points: m.points.map((p) => ({ ts: p.t + offset, rtt: typeof p.rtt_ms === "number" ? p.rtt_ms : null, failed: p.failed, checks: p.checks })),
    }));
  }, [data]);

  if (!enabled || (data && data.monitors.length === 0)) return <>{fallback}</>;

  const span = data?.span_ms ?? 3_600_000;
  const start = now - span;
  const visible = lines.filter((l) => !hidden.includes(l.id));
  const W = Math.max(box.width, 1);
  const H = Math.max(box.height, 1);
  const plotW = Math.max(1, W - PAD.l - PAD.r);
  const plotH = Math.max(1, H - PAD.t - PAD.b);
  const rtts = visible.flatMap((l) => l.points.filter((p) => p.ts >= start && p.rtt !== null).map((p) => p.rtt as number));
  const yMax = niceMax(rtts.length ? Math.max(...rtts) : 50);
  const x = (ts: number) => PAD.l + ((ts - start) / span) * plotW;
  const y = (rtt: number) => PAD.t + (1 - rtt / yMax) * plotH;
  const yTicks = [0, 1, 2, 3, 4].map((k) => (yMax / 4) * k);
  const xTicks: number[] = [];
  for (let t = Math.ceil(start / windowMeta.tick) * windowMeta.tick; t <= now; t += windowMeta.tick) xTicks.push(t);

  // Split a line where checks stopped or failed, so silence and outages show as gaps.
  const runsOf = (line: Line) => {
    const runs: { x: number; y: number }[][] = [];
    let prev: Point | null = null;
    for (const p of line.points) {
      if (p.rtt === null) {
        prev = null;
        continue;
      }
      if (!prev || p.ts - prev.ts > line.slotMs * 2.5) runs.push([]);
      runs[runs.length - 1].push({ x: x(p.ts), y: y(p.rtt) });
      prev = p;
    }
    return runs;
  };

  const newest = lines.reduce<number | null>((max, l) => {
    const last = l.points[l.points.length - 1];
    return last && (max === null || last.ts > max) ? last.ts : max;
  }, null);
  const isLive = (l: Line) => {
    const last = l.points[l.points.length - 1];
    return Boolean(last && l.enabled && now - last.ts < l.slotMs * 2 + 10_000);
  };
  const anyLive = lines.some(isLive);

  const nearest = (l: Line, ts: number) => {
    let best: Point | null = null;
    for (const p of l.points) if (!best || Math.abs(p.ts - ts) < Math.abs(best.ts - ts)) best = p;
    return best && Math.abs(best.ts - ts) <= l.slotMs * 1.5 ? best : null;
  };
  const hovered = hoverTs === null ? [] : visible.map((l) => ({ line: l, point: nearest(l, hoverTs) })).filter((h) => h.point !== null);
  const dim = (id: number) => focusId !== null && focusId !== id;
  const timeFmt = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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
          {newest !== null ? <LivePill live={anyLive} updatedAt={newest} /> : null}
          <span className="flex rounded-md border border-[var(--lp-border)] p-0.5" role="radiogroup" aria-label="Time range">
            {WINDOWS.map((w) => (
              <button
                key={w.id}
                type="button"
                role="radio"
                aria-checked={win === w.id}
                onClick={() => setWin(w.id)}
                className={cn(
                  "rounded px-2 py-0.5 text-[12px] transition-colors",
                  win === w.id ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]",
                )}
              >
                {w.label}
              </button>
            ))}
          </span>
        </span>
      </div>

      <ul className="flex flex-wrap gap-1.5 px-4 pt-3 text-[12px]" aria-label="Monitors">
        {lines.map((l) => {
          const off = hidden.includes(l.id);
          const last = l.points[l.points.length - 1];
          const down = l.status === "down";
          return (
            <li key={l.id}>
              <button
                type="button"
                aria-pressed={!off}
                title={off ? `Show ${l.label}` : `Hide ${l.label}`}
                onClick={() => setHidden((h) => (h.includes(l.id) ? h.filter((v) => v !== l.id) : [...h, l.id]))}
                onMouseEnter={() => !off && setFocusId(l.id)}
                onMouseLeave={() => setFocusId(null)}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2 py-1 transition-colors",
                  off ? "border-transparent text-[var(--lp-subtle)] line-through" : "border-[var(--lp-border)] text-[var(--lp-muted)] hover:border-[var(--lp-border-strong)] hover:text-[var(--lp-text)]",
                )}
              >
                <span className="h-2.5 w-[3px] rounded-full" style={{ background: off ? "rgba(255,255,255,0.15)" : l.color }} />
                <span className="max-w-[180px] truncate">{l.label}</span>
                {off ? null : !l.enabled ? (
                  <span className="text-[11px] text-[var(--lp-subtle)]">paused</span>
                ) : down ? (
                  <span className="text-[11px] font-medium" style={{ color: DOWN }}>
                    down
                  </span>
                ) : last?.rtt != null ? (
                  <span className="lp-mono text-[11px] text-[var(--lp-subtle)]">{formatMs(last.rtt)}ms</span>
                ) : (
                  <span className="text-[11px] text-[var(--lp-subtle)]">waiting</span>
                )}
              </button>
            </li>
          );
        })}
        {data && data.monitors.length > lines.length ? (
          <li className="flex items-center px-1 text-[var(--lp-subtle)]">
            <Link href="/monitors" className="hover:text-[var(--lp-text)]">
              +{data.monitors.length - lines.length} more
            </Link>
          </li>
        ) : null}
      </ul>

      <div ref={boxRef} className="relative mx-2 mb-2 mt-2 min-h-[210px] flex-1">
        {box.width > 0 ? (
          <svg
            width={W}
            height={H}
            className="absolute inset-0 touch-none"
            onPointerMove={(e) => {
              const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
              setHoverTs(px < PAD.l || px > W - PAD.r ? null : start + ((px - PAD.l) / plotW) * span);
            }}
            onPointerLeave={() => setHoverTs(null)}
            role="img"
            aria-label={`Response time per monitor, last ${windowMeta.label}`}
          >
            <defs>
              <clipPath id="rt-plot">
                <rect x={PAD.l} y={0} width={plotW} height={H} />
              </clipPath>
            </defs>
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.05)"} />
                <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#85858e">
                  {axisMs(v)}
                </text>
              </g>
            ))}
            {xTicks.map((t) => {
              const px = x(t);
              // Keep labels clear of the plot edges as the axis slides.
              if (px < PAD.l + 18 || px > W - PAD.r - 18) return null;
              return (
                <g key={t}>
                  <line x1={px} x2={px} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.035)" />
                  <text x={px} y={H - 8} textAnchor="middle" fontSize="11" fill="#85858e">
                    {timeFmt(t)}
                  </text>
                </g>
              );
            })}
            <g clipPath="url(#rt-plot)">
              {/* Failed checks: a red tick on the baseline, as wide as the slot. */}
              {visible.map((l) =>
                l.points
                  .filter((p) => p.failed > 0)
                  .map((p) => (
                    <rect
                      key={`${l.id}-${p.ts}`}
                      x={x(p.ts) - Math.max(2, (l.slotMs / span) * plotW) / 2}
                      y={H - PAD.b - 5}
                      width={Math.max(2, (l.slotMs / span) * plotW)}
                      height={5}
                      rx={1}
                      fill={DOWN}
                      opacity={dim(l.id) ? 0.2 : p.failed === p.checks ? 0.9 : 0.5}
                    />
                  )),
              )}
              {visible.map((l) =>
                runsOf(l).map((run, i) =>
                  run.length === 1 ? (
                    <circle key={`${l.id}-${i}`} cx={run[0].x} cy={run[0].y} r={2} fill={l.color} opacity={dim(l.id) ? 0.18 : 1} />
                  ) : (
                    <path
                      key={`${l.id}-${i}`}
                      d={smoothPath(run)}
                      fill="none"
                      stroke={l.color}
                      strokeWidth={focusId === l.id ? 2.2 : 1.6}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      opacity={dim(l.id) ? 0.18 : 1}
                      style={{ transition: "opacity 150ms ease" }}
                    />
                  ),
                ),
              )}
              {visible.map((l) => {
                const head = l.points[l.points.length - 1];
                if (!head || head.rtt === null) return null;
                const live = isLive(l);
                const hx = x(head.ts);
                const hy = y(head.rtt);
                return (
                  <g key={`head-${l.id}`} pointerEvents="none" opacity={dim(l.id) ? 0.18 : 1}>
                    {live && !reducedMotion ? <circle cx={hx} cy={hy} r="9" fill={l.color} opacity="0.35" className="lp-map-ping" /> : null}
                    <circle cx={hx} cy={hy} r={live ? 3.5 : 2.75} fill={live ? l.color : "#1b1b1f"} stroke={l.color} strokeWidth="1.5" />
                  </g>
                );
              })}
            </g>
            {hoverTs !== null ? (
              <>
                <line x1={x(hoverTs)} x2={x(hoverTs)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" />
                {hovered.map(({ line, point }) =>
                  point && point.rtt !== null ? <circle key={line.id} cx={x(point.ts)} cy={y(point.rtt)} r="3.5" fill={line.color} stroke="#1b1b1f" strokeWidth="1.5" /> : null,
                )}
              </>
            ) : null}
          </svg>
        ) : null}

        {box.width > 0 && data && !visible.some((l) => l.points.length) ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <Activity className="h-5 w-5 text-[var(--lp-subtle)]" />
            <p className="mt-3 text-[13px] text-[var(--lp-muted)]">{visible.length ? "Waiting for the first checks" : "All monitors are hidden"}</p>
            <p className="mt-1 text-[12px] text-[var(--lp-subtle)]">
              {visible.length ? "Each monitor draws its line here as soon as it checks in." : "Pick one above to show its line."}
            </p>
          </div>
        ) : null}

        {hoverTs !== null && hovered.length ? (
          <div
            className="console-popover pointer-events-none absolute top-4 z-10 w-60 p-3 text-[12px]"
            style={{ left: Math.min(Math.max(8, x(hoverTs) + 12), Math.max(8, W - 248)) }}
          >
            <div className="mb-2 text-[var(--lp-subtle)]">{clockTime(hoverTs)}</div>
            <ul className="space-y-1.5">
              {hovered.map(({ line, point }) => (
                <li key={line.id} className="flex items-center gap-2">
                  <span className="h-2.5 w-[3px] rounded-full" style={{ background: line.color }} />
                  <span className="min-w-0 flex-1 truncate text-[var(--lp-muted)]">{line.label}</span>
                  {point && point.rtt !== null ? (
                    <span className="lp-mono text-[var(--lp-text)]">
                      {formatMs(point.rtt)} <span className="text-[var(--lp-subtle)]">ms</span>
                      {point.failed ? <span style={{ color: DOWN }}> · {point.failed} failed</span> : null}
                    </span>
                  ) : (
                    <span className="font-medium" style={{ color: DOWN }}>
                      Down
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
