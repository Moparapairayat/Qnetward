import Link from "next/link";
import type { CSSProperties } from "react";
import { LandingNav } from "./landing-nav";
import { SiteFooter } from "./site-footer";
import { itemStatusLabel, phaseStatusLabel, roadmap, type ItemStatus, type RoadmapPhase } from "./roadmap-data";

const PIN = "#fbbf24";
const itemDot: Record<ItemStatus, string> = { shipped: "#4ade80", building: PIN, planned: "#6c6c75" };

// The wide layout: pins zigzag across the page, climbing left to right, with
// each phase's card above its pin. Pin heights are in px from the top of a
// fixed-height stage; cards grow upward from a stem above the pin.
const STAGE = 770;
const STEM = 40;
const PINS = [700, 330, 610, 270, 550, 220, 490];

function ItemList({ phase, compact }: { phase: RoadmapPhase; compact?: boolean }) {
  return (
    <ul className={compact ? "mt-3 space-y-1.5" : "mt-3 space-y-2"}>
      {phase.items.map((item) => (
        <li key={item.name} className="flex gap-2 text-xs leading-snug text-[var(--lp-muted)]">
          <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: itemDot[item.status] }} aria-hidden="true" />
          <span>
            {item.name}
            <span className="sr-only"> ({itemStatusLabel[item.status]})</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Card({ phase, style, className = "" }: { phase: RoadmapPhase; style?: CSSProperties; className?: string }) {
  return (
    <article
      className={`rounded-xl border border-white/[0.09] bg-[rgba(30,28,40,0.72)] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-sm ${className}`}
      style={style}
      aria-labelledby={`phase-${phase.number}`}
    >
      <h2 id={`phase-${phase.number}`} className="text-2xs font-semibold uppercase tracking-[0.14em] text-[var(--lp-text)]">
        {phase.name}
      </h2>
      <p className="mt-1 text-xs leading-snug text-[var(--lp-subtle)]">{phase.summary}</p>
      <ItemList phase={phase} compact />
    </article>
  );
}

function Pin({ building }: { building: boolean }) {
  return (
    <span className="relative grid h-5 w-5 place-items-center" aria-hidden="true">
      <span className={`absolute inset-0 rounded-full bg-[rgba(251,191,36,0.22)] ${building ? "animate-ping motion-reduce:animate-none" : ""}`} />
      <span className="absolute inset-[-6px] rounded-full bg-[rgba(251,191,36,0.08)]" />
      <span className="relative h-3 w-3 rounded-full" style={{ background: PIN, boxShadow: "0 0 14px rgba(251,191,36,0.75)" }} />
    </span>
  );
}

function PinLabel({ phase }: { phase: RoadmapPhase }) {
  return (
    // The dark backing keeps the dashed path from striking through the text.
    <span className="flex flex-col items-center rounded-md bg-[rgba(20,20,23,0.85)] px-2 py-0.5 leading-tight">
      <span className="text-xs font-medium text-[#86efac]">Phase {phase.number}</span>
      <span className="text-lg font-semibold tracking-[-0.01em]" style={{ color: phase.status === "later" ? "#d4a73c" : PIN }}>
        {phaseStatusLabel[phase.status]}
      </span>
    </span>
  );
}

/** Wide screens: the zigzag timeline. */
function ZigzagTimeline() {
  const n = roadmap.length;
  const x = (i: number) => (i + 0.5) * 100; // in the SVG's 0..n*100 width
  const path = PINS.map((y, i) => `${x(i)},${y}`).join(" ");
  // A second, fainter line below the first gives the path some depth.
  const echo = PINS.map((y, i) => `${x(i)},${y + (i % 2 ? 150 : -150)}`).join(" ");
  const col = 100 / n;
  return (
    <div className="relative hidden xl:block" style={{ height: STAGE }}>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${n * 100} ${STAGE}`} preserveAspectRatio="none" aria-hidden="true">
        <polyline points={`0,${PINS[0] + 60} ${path} ${n * 100},${PINS[n - 1] - 120}`} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeDasharray="7 6" vectorEffect="non-scaling-stroke" />
        <polyline points={echo} fill="none" stroke="rgba(167,139,250,0.32)" strokeWidth="1.2" strokeDasharray="5 7" vectorEffect="non-scaling-stroke" />
      </svg>

      {roadmap.map((phase, i) => {
        const pinY = PINS[i];
        const center = (i + 0.5) * col;
        // Cards are a little wider than a column; the end ones keep inside the page.
        const width = col * 1.3;
        const left = Math.min(Math.max(center - width / 2, 0), 100 - width);
        return (
          <div key={phase.number}>
            <Card phase={phase} className="absolute" style={{ left: `${left}%`, width: `${width}%`, bottom: STAGE - pinY + STEM }} />
            <span
              className="absolute w-px bg-gradient-to-b from-[rgba(251,191,36,0.15)] to-[rgba(251,191,36,0.7)]"
              style={{ left: `${center}%`, top: pinY - STEM, height: STEM - 10 }}
              aria-hidden="true"
            />
            <span className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${center}%`, top: pinY }}>
              <Pin building={phase.status === "building"} />
            </span>
            <span className="absolute -translate-x-1/2" style={{ left: `${center}%`, top: pinY + 14 }}>
              <PinLabel phase={phase} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Narrow screens: the same timeline, running down the page. */
function VerticalTimeline() {
  return (
    <ol className="relative ml-2 border-l border-dashed border-white/25 xl:hidden">
      {roadmap.map((phase) => (
        <li key={phase.number} className="relative pb-10 pl-8 last:pb-0">
          <span className="absolute -left-[10px] top-1">
            <Pin building={phase.status === "building"} />
          </span>
          <p className="flex items-baseline gap-3">
            <span className="text-xs font-medium text-[#86efac]">Phase {phase.number}</span>
            <span className="text-lg font-semibold" style={{ color: phase.status === "later" ? "#d4a73c" : PIN }}>
              {phaseStatusLabel[phase.status]}
            </span>
          </p>
          <Card phase={phase} className="mt-3 max-w-md" />
        </li>
      ))}
    </ol>
  );
}

export function RoadmapPage() {
  const shipped = roadmap.flatMap((p) => p.items).filter((i) => i.status === "shipped").length;
  const total = roadmap.flatMap((p) => p.items).length;

  return (
    <>
      <LandingNav />
      <main id="main" className="relative overflow-hidden">
        {/* The purple glow the timeline sits in. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[70%]"
          style={{ background: "radial-gradient(ellipse 85% 75% at 65% 100%, rgba(124,58,237,0.42), rgba(76,29,149,0.2) 45%, transparent 78%)" }}
          aria-hidden="true"
        />

        <div className="lp-container relative max-w-7xl py-20">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.4em] text-[var(--lp-subtle)]">Qnetward</p>
              <h1 className="mt-3 text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-5xl">Road Map</h1>
              <p className="mt-5 max-w-xl text-md leading-relaxed text-[var(--lp-muted)]">
                Seven phases, in the order we build them. No dates on purpose: we&apos;d rather ship something and mark it done than promise a
                quarter and miss it.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:items-end">
              <p className="text-sm text-[var(--lp-muted)]">
                <span className="text-2xl font-semibold text-[var(--lp-text)]">{shipped}</span> of {total} features in the console today
              </p>
              <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--lp-subtle)]">
                {(Object.keys(itemDot) as ItemStatus[]).map((s) => (
                  <li key={s} className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: itemDot[s] }} aria-hidden="true" />
                    {itemStatusLabel[s]}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-14 xl:mt-10">
            <ZigzagTimeline />
            <VerticalTimeline />
          </div>

          <div className="relative mt-20 rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-bg-raised)]/80 p-8 backdrop-blur-sm sm:flex sm:items-center sm:justify-between sm:gap-8">
            <div>
              <h2 className="text-lg font-normal">Everything that&apos;s shipped is in the console now</h2>
              <p className="mt-1.5 text-base text-[var(--lp-muted)]">Start free, and new phases show up in the same workspace as they land.</p>
            </div>
            <div className="mt-5 flex shrink-0 gap-3 sm:mt-0">
              <Link href="/signup" className="lp-btn lp-btn-primary">
                Start free
              </Link>
              <Link href="/" className="lp-btn lp-btn-secondary">
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
