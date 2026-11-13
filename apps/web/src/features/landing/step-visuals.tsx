import { QnetwardMark } from "./qnetward-mark";

/*
 * Small static UI fragments for "How it works" and the closing call to action.
 * They are illustrations of the console with example targets, not live data,
 * so they are hidden from assistive tech; the text next to them says the same.
 */

function Frame({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`rounded-xl border border-[var(--lp-border-strong)] bg-[#17171b] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.35)] ${className}`}
    >
      {children}
    </div>
  );
}

export function WorkspaceVisual() {
  return (
    <Frame className="max-w-md">
      <div className="flex items-center gap-2">
        <QnetwardMark size={18} />
        <span className="text-xs text-[var(--lp-muted)]">Create your workspace</span>
      </div>
      <div className="mt-3 flex gap-2">
        <div className="lp-mono flex h-8 min-w-0 flex-1 items-center rounded-md border border-[var(--lp-border-strong)] bg-white/[0.03] px-2.5 text-xs text-[var(--lp-text)]">
          you@company.com
        </div>
        <div className="flex h-8 shrink-0 items-center rounded-md bg-[var(--lp-accent)] px-3 text-xs font-medium text-white">Sign up</div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-[var(--lp-subtle)]">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--lp-green)]" />
        Workspace ready · invite teammates any time
      </div>
    </Frame>
  );
}

// A short latency trace: steady replies with one slow probe.
const trace = [12, 11, 13, 12, 14, 12, 11, 30, 13, 12, 11, 12, 13, 12, 11, 12];

export function ProbeVisual() {
  const w = 220;
  const h = 44;
  const max = 34;
  const step = w / (trace.length - 1);
  const path = trace.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return (
    <Frame className="max-w-md">
      <div className="lp-mono flex items-center justify-between gap-3 text-xs">
        <span className="truncate text-[var(--lp-text)]">
          <span className="text-[var(--lp-subtle)]">$</span> tcpping db.internal:5432
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[var(--lp-green)]">
          <span className="lp-pulse h-1.5 w-1.5 rounded-full bg-[var(--lp-green)]" />
          live
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-11 w-full" preserveAspectRatio="none">
        <path d={`${path} L${w},${h} L0,${h} Z`} fill="rgba(255,61,127,0.08)" />
        <path d={path} fill="none" stroke="var(--lp-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="lp-mono mt-2 flex gap-4 text-2xs text-[var(--lp-subtle)]">
        <span>16 / 16 replies</span>
        <span>avg 13.2 ms</span>
        <span>0% loss</span>
      </div>
    </Frame>
  );
}

type Row = { name: string; detail: string; status: "up" | "down"; misses: number[] };

function CheckStrip({ misses, count = 30 }: { misses: number[]; count?: number }) {
  return (
    <div className="flex h-4 gap-[2px]">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`flex-1 rounded-[1.5px] ${misses.includes(i) ? "bg-[#ff3d7f]" : "bg-[#4ade80]/75"}`} />
      ))}
    </div>
  );
}

function MonitorRow({ row }: { row: Row }) {
  const up = row.status === "up";
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${up ? "bg-[var(--lp-green)]" : "bg-[var(--lp-accent)]"}`} />
          <span className="lp-mono truncate text-[var(--lp-text)]">{row.name}</span>
        </span>
        <span
          className={`shrink-0 rounded border px-1.5 py-px text-2xs ${
            up ? "border-[rgba(74,222,128,0.25)] text-[#86efac]" : "border-[rgba(255,61,127,0.3)] text-[#ff8fb3]"
          }`}
        >
          {up ? "Up" : "Down"}
        </span>
      </div>
      <div className="mt-2">
        <CheckStrip misses={row.misses} />
      </div>
      <p className="mt-1.5 text-2xs text-[var(--lp-subtle)]">{row.detail}</p>
    </div>
  );
}

const exampleMonitor: Row = { name: "api.acme.dev/health", detail: "HTTPS · every 1 min · 200 in 142 ms · certificate 61 days", status: "up", misses: [21] };

export function MonitorVisual() {
  return (
    <Frame className="max-w-md">
      <MonitorRow row={exampleMonitor} />
    </Frame>
  );
}

const ctaRows: Row[] = [
  exampleMonitor,
  { name: "db.internal:5432", detail: "TCP · every 1 min · 3.1 ms", status: "up", misses: [] },
  { name: "shop.acme.dev", detail: "HTTPS · returned 502 · email sent", status: "down", misses: [27, 28, 29] },
];

export function MonitorStackVisual() {
  return (
    <Frame className="w-full p-5">
      <div className="flex items-center justify-between border-b border-[var(--lp-border)] pb-3 text-xs">
        <span className="text-[var(--lp-text)]">Monitors</span>
        <span className="text-[var(--lp-subtle)]">Example workspace</span>
      </div>
      <div className="mt-4 space-y-4">
        {ctaRows.map((row) => (
          <MonitorRow key={row.name} row={row} />
        ))}
      </div>
    </Frame>
  );
}
