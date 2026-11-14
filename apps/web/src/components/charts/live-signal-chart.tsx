"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

export type SignalPoint = { t: number; v: number | null; label?: string };

type View = { now: number; yMin: number; yMax: number };

const W = 800;

/** Catmull-Rom to cubic Bézier, with control points clamped so the curve never overshoots in x or y. */
export function smoothPath(pts: { x: number; y: number }[]) {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const lo = Math.min(p1.y, p2.y);
    const hi = Math.max(p1.y, p2.y);
    // Keep control points between their two anchors so uneven spacing never loops the curve backwards.
    const c1x = Math.min(p2.x, Math.max(p1.x, p1.x + (p2.x - p0.x) / 6));
    const c1y = Math.min(hi, Math.max(lo, p1.y + (p2.y - p0.y) / 6));
    const c2x = Math.min(p2.x, Math.max(p1.x, p2.x - (p3.x - p1.x) / 6));
    const c2y = Math.min(hi, Math.max(lo, p2.y - (p3.y - p1.y) / 6));
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function targetRange(points: SignalPoint[]) {
  const vals = points.map((p) => p.v).filter((v): v is number => typeof v === "number");
  if (!vals.length) return { yMin: 0, yMax: 10 };
  const hi = Math.max(...vals);
  const lo = Math.min(...vals);
  const span = Math.max(2, hi - lo);
  return { yMin: Math.max(0, lo - span * 0.25), yMax: hi + span * 0.25 };
}

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

function formatMs(v: number) {
  return v >= 100 ? `${Math.round(v)} ms` : `${v.toFixed(1)} ms`;
}

/**
 * A live, scrolling signal line. While `live`, the time axis advances every
 * frame so the trace slides left like a monitor; the newest reading gets a
 * glowing head and failed probes flash on the floor. Hovering pauses the
 * motion so a point can be read. Honours prefers-reduced-motion.
 */
export function LiveSignalChart({
  points,
  live,
  windowMs = 60_000,
  height = 220,
  emptyText,
}: {
  points: SignalPoint[];
  live: boolean;
  windowMs?: number;
  height?: number;
  emptyText: string;
}) {
  const H = height;
  const PAD = { l: 56, r: 64, t: 14, b: 24 };
  const svgRef = useRef<SVGSVGElement>(null);
  const targetRef = useRef(targetRange(points));
  const [hoverX, setHoverX] = useState<number | null>(null);
  const reduced = usePrefersReducedMotion();
  const [animated, setAnimated] = useState<View>(() => ({ now: Date.now(), ...targetRange(points) }));
  const paused = hoverX !== null;
  const animating = live && !reduced;
  const staticRange = useMemo(() => targetRange(points), [points]);
  // When not animating, the time axis is driven by the data itself, so `now` is unused.
  const view = useMemo<View>(() => (animating ? animated : { now: animated.now, ...staticRange }), [animating, animated, staticRange]);

  useEffect(() => {
    targetRef.current = staticRange;
  }, [staticRange]);

  // Animation loop: advance time and ease the y-range toward its target.
  useEffect(() => {
    if (!animating || paused) return;
    let raf = 0;
    const tick = () => {
      setAnimated((prev) => {
        const t = targetRef.current;
        const ease = 0.12;
        return { now: Date.now(), yMin: prev.yMin + (t.yMin - prev.yMin) * ease, yMax: prev.yMax + (t.yMax - prev.yMax) * ease };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animating, paused]);

  const geometry = useMemo(() => {
    if (!points.length) return null;
    const first = points[0].t;
    const last = points[points.length - 1].t;
    const end = live ? view.now : last;
    const start = live ? end - windowMs : Math.min(first, last - 1000);
    const x = (t: number) => PAD.l + ((t - start) / Math.max(1, end - start)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - view.yMin) / Math.max(1e-6, view.yMax - view.yMin)) * (H - PAD.t - PAD.b);
    const visible = points.filter((p) => p.t >= start - 5000);

    // Split into runs of successful readings so failures break the line.
    const runs: { x: number; y: number }[][] = [];
    let current: { x: number; y: number }[] = [];
    for (const p of visible) {
      if (typeof p.v === "number") current.push({ x: x(p.t), y: y(p.v) });
      else if (current.length) {
        runs.push(current);
        current = [];
      }
    }
    if (current.length) runs.push(current);

    const lastOk = [...visible].reverse().find((p) => typeof p.v === "number");
    const okVals = visible.map((p) => p.v).filter((v): v is number => typeof v === "number");
    const sorted = [...okVals].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    return { start, end, x, y, runs, visible, lastOk, median };
  }, [points, live, view, windowMs, H, PAD.l, PAD.r, PAD.t, PAD.b]);

  if (!geometry) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-[var(--lp-border)] text-sm text-[var(--lp-subtle)]" style={{ height }}>
        {emptyText}
      </div>
    );
  }

  const { start, end, x, y, runs, visible, lastOk, median } = geometry;
  const headColor = !lastOk || typeof lastOk.v !== "number" ? "#fbbf24" : median && lastOk.v > median * 2 ? "#ff3d7f" : median && lastOk.v > median * 1.4 ? "#fbbf24" : "#4ade80";
  const ticks = [0, 0.5, 1].map((f) => view.yMin + (view.yMax - view.yMin) * f);
  const nowTs = view.now;

  let hovered: SignalPoint | null = null;
  if (hoverX !== null) {
    const t = start + ((hoverX - PAD.l) / (W - PAD.l - PAD.r)) * (end - start);
    hovered = visible.reduce<SignalPoint | null>((best, p) => (!best || Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), null);
  }

  const timeLabels = live
    ? [
        { t: start, label: `-${Math.round(windowMs / 1000)}s` },
        { t: start + windowMs / 2, label: `-${Math.round(windowMs / 2000)}s` },
        { t: end, label: "now" },
      ]
    : [];

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        style={{ height }}
        preserveAspectRatio="none"
        role="img"
        aria-label="Latency signal"
        onPointerMove={(e) => {
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          setHoverX(Math.min(W - PAD.r, Math.max(PAD.l, ((e.clientX - rect.left) / rect.width) * W)));
        }}
        onPointerLeave={() => setHoverX(null)}
      >
        <defs>
          <linearGradient id="signal-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff3d7f" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#ff3d7f" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="signal-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff3d7f" stopOpacity="0.25" />
            <stop offset="12%" stopColor="#ff3d7f" stopOpacity="1" />
          </linearGradient>
          <clipPath id="signal-clip">
            <rect x={PAD.l} y={0} width={W - PAD.l - PAD.r + 2} height={H} />
          </clipPath>
        </defs>

        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.05)" vectorEffect="non-scaling-stroke" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#85858e">
              {v >= 100 ? Math.round(v) : v.toFixed(1)}ms
            </text>
          </g>
        ))}
        {timeLabels.map((tl) => (
          <text key={tl.label} x={x(tl.t)} y={H - 6} textAnchor={tl.label === "now" ? "end" : "middle"} fontSize="10" fill="#85858e">
            {tl.label}
          </text>
        ))}

        <g clipPath="url(#signal-clip)">
          {runs.map((run, i) => {
            const d = smoothPath(run);
            const area = run.length > 1 ? `${d} L${run[run.length - 1].x.toFixed(1)},${H - PAD.b} L${run[0].x.toFixed(1)},${H - PAD.b} Z` : "";
            return (
              <g key={i}>
                {area ? <path d={area} fill="url(#signal-fill)" /> : null}
                <path d={d} fill="none" stroke={live ? "url(#signal-fade)" : "#ff3d7f"} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
          {visible.map((p, i) =>
            typeof p.v === "number" ? null : (
              <g key={`f${i}`} className={nowTs - p.t < 2500 ? "lp-signal-flash" : undefined}>
                <line x1={x(p.t)} x2={x(p.t)} y1={H - PAD.b - 14} y2={H - PAD.b} stroke="#ff3d7f" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                <circle cx={x(p.t)} cy={H - PAD.b - 16} r="2" fill="#ff3d7f" />
              </g>
            ),
          )}
        </g>

        {lastOk && typeof lastOk.v === "number" ? (
          <g>
            {live && !reduced ? <circle cx={x(lastOk.t)} cy={y(lastOk.v)} r="9" fill={headColor} opacity="0.25" className="lp-map-ping" /> : null}
            <circle cx={x(lastOk.t)} cy={y(lastOk.v)} r="4" fill={headColor} stroke="#0a0a0a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <line x1={x(lastOk.t)} x2={W - PAD.r + 6} y1={y(lastOk.v)} y2={y(lastOk.v)} stroke={headColor} strokeOpacity="0.35" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            <text x={W - PAD.r + 10} y={y(lastOk.v) + 4} fontSize="12" fill={headColor} fontFamily="var(--font-geist-mono), monospace">
              {lastOk.v >= 100 ? Math.round(lastOk.v) : lastOk.v.toFixed(1)}
            </text>
          </g>
        ) : null}

        {hovered && hoverX !== null ? (
          <line x1={x(hovered.t)} x2={x(hovered.t)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.2)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        ) : null}
      </svg>

      {hovered && hoverX !== null ? (
        <div
          className="console-popover pointer-events-none absolute top-2 px-2.5 py-1.5 text-xs"
          style={{ left: `clamp(8px, calc(${(x(hovered.t) / W) * 100}% + 10px), calc(100% - 160px))` }}
        >
          <span className="text-[var(--lp-subtle)]">{hovered.label ?? new Date(hovered.t).toLocaleTimeString()} · </span>
          <span className="lp-mono" style={{ color: typeof hovered.v === "number" ? "var(--lp-text)" : "#ff8fb3" }}>
            {typeof hovered.v === "number" ? formatMs(hovered.v) : "timeout"}
          </span>
        </div>
      ) : null}
      {live && paused ? <span className="absolute right-2 top-2 rounded bg-black/40 px-1.5 py-0.5 text-2xs text-[var(--lp-muted)]">Paused</span> : null}
    </div>
  );
}

/** "● LIVE" pill for chart headers. */
export function LivePill({ live, updatedAt }: { live: boolean; updatedAt?: number | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!updatedAt) return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [updatedAt]);
  // Recomputed on each 1s tick above; Date.now() here is read in render deliberately.
  // eslint-disable-next-line react-hooks/purity
  const ago = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null;
  return (
    <span className="flex items-center gap-2 text-xs">
      {live ? (
        <span className="inline-flex items-center gap-1.5 rounded border border-[rgba(255,61,127,0.35)] bg-[rgba(255,61,127,0.08)] px-1.5 py-px font-medium text-[#ff8fb3]">
          <span className="lp-pulse h-1.5 w-1.5 rounded-full bg-[var(--lp-accent)]" /> LIVE
        </span>
      ) : null}
      {ago !== null ? <span className="text-[var(--lp-subtle)]">{ago < 2 ? "just now" : `${ago}s ago`}</span> : null}
    </span>
  );
}
