import { Eye, Lock } from "@/components/icons";
import type { Cell, FeaturePreview, Tone } from "@/features/previews/feature-previews";
import {
  AssistantVisual,
  FlowsVisual,
  ScheduleVisual,
  TimelineVisual,
  TopologyVisual,
} from "@/features/previews/preview-visuals";
import { cn } from "@/lib/utils";

const toneClass: Record<Tone, string> = {
  good: "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]",
  warn: "border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.08)] text-[#fcd34d]",
  bad: "border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] text-[#ff8fb3]",
  info: "border-[rgba(167,139,250,0.3)] bg-[rgba(167,139,250,0.08)] text-[#c4b5fd]",
  muted: "border-[var(--lp-border)] bg-white/[0.03] text-[var(--lp-muted)]",
};

const toneText: Record<Tone, string> = {
  good: "#4ade80",
  warn: "#fbbf24",
  bad: "#ff3d7f",
  info: "#a78bfa",
  muted: "var(--lp-text)",
};

function CellView({ cell }: { cell: Cell }) {
  if (typeof cell === "string") return <>{cell}</>;
  if (cell.tone) {
    return <span className={cn("inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-xs", toneClass[cell.tone])}>{cell.text}</span>;
  }
  return <span className={cn(cell.mono && "lp-mono text-xs")}>{cell.text}</span>;
}

function Visual({ kind }: { kind: NonNullable<FeaturePreview["visual"]> }) {
  switch (kind) {
    case "topology":
      return <TopologyVisual />;
    case "assistant":
      return <AssistantVisual />;
    case "flows":
      return <FlowsVisual />;
    case "timeline":
      return <TimelineVisual />;
    case "schedule":
      return <ScheduleVisual />;
  }
}

/**
 * Template for planned features: a realistic layout filled with sample data,
 * behind a banner that says so. Actions are disabled.
 */
export function PreviewPage({ feature }: { feature: FeaturePreview }) {
  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <div className="flex items-center gap-3 rounded-lg border border-[rgba(167,139,250,0.3)] bg-[rgba(167,139,250,0.06)] px-4 py-2.5 text-sm text-[#c4b5fd]">
        <Eye className="h-4 w-4 shrink-0" />
        <span>
          <span className="font-medium">Preview.</span> Everything on this screen is sample data. {feature.title} is planned for Phase {feature.phase}{" "}
          ({feature.phaseName}).
        </span>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-medium tracking-[-0.02em]">{feature.title}</h1>
            <span className="rounded-md border border-[var(--lp-border)] px-1.5 py-0.5 text-2xs text-[var(--lp-subtle)]">
              Phase {feature.phase}
            </span>
          </div>
          <p className="mt-1 text-base leading-relaxed text-[var(--lp-muted)]">{feature.description}</p>
        </div>
        <button type="button" disabled title={`Available in Phase ${feature.phase}`} className="console-btn console-btn-primary shrink-0">
          <Lock className="h-3.5 w-3.5" /> {feature.primaryAction}
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {feature.stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-4">
            <dt className="text-sm text-[var(--lp-muted)]">{stat.label}</dt>
            <dd className="mt-2 truncate text-xl font-medium tracking-[-0.02em]" style={{ color: stat.tone ? toneText[stat.tone] : undefined }}>
              {stat.value}
            </dd>
            <p className="mt-1 truncate text-xs text-[var(--lp-subtle)]">{stat.hint}</p>
          </div>
        ))}
      </dl>

      {feature.visual || feature.side ? (
        <div className={cn("grid grid-cols-1 gap-5 [&>*]:min-w-0", feature.visual && feature.side && "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]")}>
          {feature.visual ? <Visual kind={feature.visual} /> : null}
          {feature.side ? (
            <section className="rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-5">
              <h2 className="text-base font-medium">{feature.side.title}</h2>
              <ul className="mt-4 divide-y divide-[var(--lp-border)] text-sm">
                {feature.side.items.map((item) => (
                  <li key={item.label} className="flex items-center justify-between py-3">
                    <span>{item.label}</span>
                    <span className="lp-mono" style={{ color: item.tone ? toneText[item.tone] : undefined }}>
                      {item.value}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}

      {feature.table ? (
        <section className="overflow-hidden rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f]">
          <div className="px-4 py-3 text-base font-medium">{feature.table.title}</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-y border-[var(--lp-border)] bg-white/[0.015] text-left text-xs text-[var(--lp-subtle)]">
                  {feature.table.columns.map((col) => (
                    <th key={col} className="px-4 py-2.5 font-medium">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {feature.table.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-[var(--lp-border)] last:border-b-0">
                    {row.map((cell, ci) => (
                      <td key={ci} className={cn("px-4 py-3", ci === 0 ? "text-[var(--lp-text)]" : "text-[var(--lp-muted)]")}>
                        <CellView cell={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-5">
        <h2 className="text-base font-medium">What this will do</h2>
        <ul className="mt-3 grid gap-x-8 gap-y-2 text-sm text-[var(--lp-muted)] sm:grid-cols-2">
          {feature.capabilities.map((cap) => (
            <li key={cap} className="flex gap-2.5">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--lp-accent)]" />
              {cap}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
