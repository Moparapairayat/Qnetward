"use client";

import { ReactNode, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AnimatedValue } from "@/components/charts/animated-value";

/* Shared building blocks for the diagnostic tool pages. */

export type RunTone = "idle" | "live" | "done" | "error";

export function PageHeader({ title, description, status }: { title: string; description: string; status?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-[24px] font-medium tracking-[-0.02em]">{title}</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-[var(--lp-muted)]">{description}</p>
      </div>
      {status}
    </div>
  );
}

const toneStyle: Record<RunTone, { dot: string; text: string; border: string }> = {
  idle: { dot: "#85858e", text: "var(--lp-muted)", border: "var(--lp-border)" },
  live: { dot: "#4ade80", text: "#86efac", border: "rgba(74,222,128,0.3)" },
  done: { dot: "#a78bfa", text: "#c4b5fd", border: "rgba(167,139,250,0.3)" },
  error: { dot: "#ff3d7f", text: "#ff8fb3", border: "rgba(255,61,127,0.3)" },
};

export function RunStatus({ tone, label }: { tone: RunTone; label: string }) {
  const s = toneStyle[tone];
  return (
    <span
      className="inline-flex h-7 items-center gap-2 self-start rounded-md border px-2.5 text-[12px] sm:self-auto"
      style={{ borderColor: s.border, color: s.text }}
      role="status"
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", tone === "live" && "lp-pulse")} style={{ background: s.dot }} />
      {label}
    </span>
  );
}

export function Panel({ title, aside, children, className, bodyClassName }: { title?: string; aside?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f]", className)}>
      {title ? (
        <div className="flex items-center justify-between gap-3 px-4 pt-4">
          <h2 className="text-[14px] font-medium">{title}</h2>
          {aside}
        </div>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[12px] text-[var(--lp-muted)]">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[12px] text-[#ff8fb3]">{error}</span> : hint ? <span className="mt-1 block text-[12px] text-[var(--lp-subtle)]">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ label, description, ...input }: { label: string; description?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-[13px]">
      <span className="relative mt-0.5 inline-flex">
        <input type="checkbox" className="peer sr-only" {...input} />
        <span className="h-4 w-7 rounded-full bg-white/[0.12] transition-colors peer-checked:bg-[var(--lp-accent)] peer-focus-visible:ring-2 peer-focus-visible:ring-[rgba(255,61,127,0.45)]" />
        <span className="absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform peer-checked:translate-x-3" />
      </span>
      <span>
        <span className="text-[var(--lp-text)]">{label}</span>
        {description ? <span className="block text-[12px] text-[var(--lp-subtle)]">{description}</span> : null}
      </span>
    </label>
  );
}

export function StatStrip({ items }: { items: { label: string; value: string; tone?: "good" | "warn" | "bad"; better?: "lower" | "higher" }[] }) {
  const color = { good: "#4ade80", warn: "#fbbf24", bad: "#ff3d7f" };
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[var(--lp-border)] bg-[var(--lp-border)] sm:grid-cols-3 xl:grid-cols-6">
      {items.map((item) => (
        <div key={item.label} className="bg-[#1b1b1f] px-4 py-3.5">
          <dt className="text-[12px] text-[var(--lp-subtle)]">{item.label}</dt>
          <dd className="lp-mono mt-1 truncate text-[18px]" style={{ color: item.tone ? color[item.tone] : undefined }}>
            <AnimatedValue value={item.value} better={item.better} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Live latency chart for a single target. Failed probes render as markers on the floor. */
export function LatencyChart({ points, emptyText }: { points: { seq: number; rtt: number | null }[]; emptyText: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 800;
  const H = 220;
  const PAD = { l: 56, r: 10, t: 12, b: 22 };

  const { max, min } = useMemo(() => {
    const vals = points.map((p) => p.rtt).filter((v): v is number => typeof v === "number");
    if (!vals.length) return { max: 10, min: 0 };
    const hi = Math.max(...vals);
    const lo = Math.min(...vals);
    const span = Math.max(1, hi - lo);
    return { max: hi + span * 0.2, min: Math.max(0, lo - span * 0.2) };
  }, [points]);

  if (points.length === 0) {
    return <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed border-[var(--lp-border)] text-[13px] text-[var(--lp-subtle)]">{emptyText}</div>;
  }

  const n = Math.max(1, points.length - 1);
  const x = (i: number) => PAD.l + (i / n) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - min) / Math.max(1e-6, max - min)) * (H - PAD.t - PAD.b);
  let path = "";
  points.forEach((p, i) => {
    if (typeof p.rtt !== "number") return;
    const prev = points[i - 1];
    path += `${i === 0 || typeof prev?.rtt !== "number" ? "M" : "L"}${x(i).toFixed(1)},${y(p.rtt).toFixed(1)} `;
  });
  const ticks = [0, 0.5, 1].map((f) => min + (max - min) * f);
  const hp = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-[220px] w-full touch-none"
        preserveAspectRatio="none"
        role="img"
        aria-label="Latency per probe"
        onPointerMove={(e) => {
          const rect = svgRef.current?.getBoundingClientRect();
          if (!rect) return;
          const px = ((e.clientX - rect.left) / rect.width) * W;
          setHover(Math.round(Math.min(1, Math.max(0, (px - PAD.l) / (W - PAD.l - PAD.r))) * n));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.05)" vectorEffect="non-scaling-stroke" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#85858e">
              {v >= 100 ? Math.round(v) : v.toFixed(1)}ms
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#ff3d7f" strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) =>
          typeof p.rtt === "number" ? null : (
            <line key={i} x1={x(i)} x2={x(i)} y1={H - PAD.b - 10} y2={H - PAD.b} stroke="#fbbf24" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          ),
        )}
        {hp && hover !== null ? (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            {typeof hp.rtt === "number" ? <circle cx={x(hover)} cy={y(hp.rtt)} r="3.5" fill="#ff3d7f" stroke="#1b1b1f" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /> : null}
          </>
        ) : null}
      </svg>
      {hp && hover !== null ? (
        <div
          className="console-popover pointer-events-none absolute top-2 px-2.5 py-1.5 text-[12px]"
          style={{ left: `clamp(8px, calc(${(x(hover) / W) * 100}% + 10px), calc(100% - 130px))` }}
        >
          <span className="text-[var(--lp-subtle)]">seq {hp.seq} · </span>
          <span className="lp-mono" style={{ color: typeof hp.rtt === "number" ? "var(--lp-text)" : "#fbbf24" }}>
            {typeof hp.rtt === "number" ? `${hp.rtt.toFixed(1)} ms` : "timeout"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function DefinitionList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-[var(--lp-border)] text-[13px]">
      {items.map((item) => (
        <div key={item.label} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="text-[var(--lp-subtle)]">{item.label}</dt>
          <dd className="lp-mono truncate text-right text-[var(--lp-text)]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
