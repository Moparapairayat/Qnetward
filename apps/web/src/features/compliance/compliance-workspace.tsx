"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, ClipboardCheck, Download } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { ComplianceControl, ComplianceReport, ComplianceStatus } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { PageHeader, Panel, RunStatus } from "@/components/tools/probe-ui";

const statusMeta: Record<ComplianceStatus, { label: string; pill: string; bar: string }> = {
  fail: { label: "Fail", pill: "border-[rgba(255,61,127,0.45)] bg-[rgba(255,61,127,0.15)] text-[#ff8fb3]", bar: "bg-[#ff3d7f]" },
  warn: { label: "Needs attention", pill: "border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.08)] text-[#fcd34d]", bar: "bg-[#fbbf24]" },
  pass: { label: "Pass", pill: "border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.08)] text-[#86efac]", bar: "bg-[#4ade80]" },
  not_assessed: { label: "Not assessed", pill: "border-[var(--lp-border)] bg-white/[0.03] text-[var(--lp-subtle)]", bar: "bg-white/[0.12]" },
};
const statusOrder: ComplianceStatus[] = ["fail", "warn", "pass", "not_assessed"];

const sevColor: Record<string, string> = { high: "text-[#ff8fb3]", medium: "text-[#fcd34d]", low: "text-[#93c5fd]" };

// Where to go to fix or assess a control.
const controlPage: Record<string, { href: string; label: string }> = {
  "asset-inventory": { href: "/assets", label: "Assets" },
  "exposed-services": { href: "/attack-surface", label: "Attack surface" },
  "dangling-dns": { href: "/attack-surface", label: "Attack surface" },
  "scheduled-scanning": { href: "/attack-surface", label: "Attack surface" },
  "known-vulnerabilities": { href: "/vulnerabilities", label: "Vulnerabilities" },
  "exposed-files": { href: "/scans", label: "Deep scans" },
  "availability-monitoring": { href: "/monitors", label: "Monitors" },
};

function StatusPill({ status }: { status: ComplianceStatus }) {
  return <span className={cn("inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-[11px]", statusMeta[status].pill)}>{statusMeta[status].label}</span>;
}

function FrameworkCard({ fw, active, onClick }: { fw: ComplianceReport["frameworks"][number]; active: boolean; onClick: () => void }) {
  const parts: [ComplianceStatus, number][] = [
    ["pass", fw.passing],
    ["warn", fw.warning],
    ["fail", fw.failing],
    ["not_assessed", fw.not_assessed],
  ];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "grid gap-2.5 rounded-xl border px-4 py-3.5 text-left transition-colors",
        active ? "border-[var(--lp-accent)] bg-[rgba(255,61,127,0.06)]" : "border-[var(--lp-border)] bg-[#1b1b1f] hover:border-white/20",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium">{fw.short}</span>
        <span className="lp-mono text-[18px]" style={{ color: fw.assessed ? (fw.failing ? "#ff8fb3" : fw.warning ? "#fcd34d" : "#86efac") : undefined }}>
          {fw.assessed ? `${fw.percent}%` : "–"}
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        {parts.map(([s, n]) => (n ? <span key={s} className={statusMeta[s].bar} style={{ width: `${(n / fw.mapped) * 100}%` }} /> : null))}
      </div>
      <span className="text-[12px] text-[var(--lp-subtle)]">
        {fw.passing} of {fw.assessed} assessed controls pass · {fw.mapped} mapped
      </span>
    </button>
  );
}

function ControlRow({ control, framework, frameworks }: { control: ComplianceControl; framework: string; frameworks: ComplianceReport["frameworks"] }) {
  const [open, setOpen] = useState(control.status === "fail");
  const page = controlPage[control.id];
  const refs = frameworks.filter((f) => (framework ? f.id === framework : true) && control.refs[f.id]?.length);
  return (
    <li className="border-t border-[var(--lp-border)] first:border-t-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.02]">
        <StatusPill status={control.status} />
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="text-[14px]">{control.title}</span>
          <span className="text-[12px] text-[var(--lp-subtle)]">
            {control.area} · {control.summary}
          </span>
          <span className="flex flex-wrap gap-1.5">
            {refs.map((f) =>
              control.refs[f.id].map((r) => (
                <span key={`${f.id}-${r}`} className="lp-mono rounded border border-[var(--lp-border)] px-1.5 py-px text-[11px] text-[var(--lp-muted)]">
                  {f.short} {r}
                </span>
              )),
            )}
          </span>
        </span>
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-[var(--lp-subtle)] transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="grid gap-3 px-4 pb-4 pl-[calc(1rem+theme(spacing.3))] sm:pl-4">
          <p className="text-[13px] leading-relaxed text-[var(--lp-muted)]">{control.description}</p>
          {control.evidence.length ? (
            <ul className="grid gap-1.5 rounded-lg border border-[var(--lp-border)] bg-white/[0.02] p-3">
              {control.evidence.slice(0, 50).map((e, i) => (
                <li key={`${e.id}-${e.host}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
                  <span className={cn("lp-mono uppercase", sevColor[e.severity] ?? "text-[var(--lp-subtle)]")}>{e.severity}</span>
                  <span className="min-w-0 break-words text-[var(--lp-text)]">{e.title}</span>
                  {e.host || e.domain ? <span className="lp-mono text-[var(--lp-subtle)]">{e.host || e.domain}</span> : null}
                  {e.scan_id ? <span className="text-[var(--lp-subtle)]">scan #{e.scan_id}, {formatDateTime(e.at)}</span> : null}
                </li>
              ))}
              {control.evidence.length > 50 ? <li className="text-[12px] text-[var(--lp-subtle)]">and {control.evidence.length - 50} more in the CSV export.</li> : null}
            </ul>
          ) : control.status === "pass" && control.domains.length ? (
            <p className="text-[12px] text-[var(--lp-subtle)]">
              Checked on <span className="lp-mono">{control.domains.join(", ")}</span>.
            </p>
          ) : null}
          {control.status === "fail" || control.status === "warn" || control.status === "not_assessed" ? (
            <div className="flex flex-wrap items-center gap-3">
              {control.status !== "not_assessed" ? <p className="text-[12px] text-[var(--lp-muted)]">Fix: {control.fix}</p> : null}
              {page ? (
                <Link href={page.href} className="inline-flex items-center gap-1 text-[12px] text-[var(--lp-text)] hover:underline">
                  Open {page.label} <ArrowUpRight className="h-3 w-3" />
                </Link>
              ) : (
                <Link href="/passive-checks" className="inline-flex items-center gap-1 text-[12px] text-[var(--lp-text)] hover:underline">
                  Open Passive checks <ArrowUpRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ComplianceWorkspace() {
  const [framework, setFramework] = useState("");
  const [status, setStatus] = useState<ComplianceStatus | "all">("all");
  const report = useQuery({ queryKey: ["compliance"], queryFn: () => apiRequest<ComplianceReport>("/api/security/compliance") });
  const data = report.data;
  const controls = (data?.controls ?? [])
    .filter((c) => (!framework || c.refs[framework]?.length) && (status === "all" || c.status === status))
    .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));
  const counts = data?.counts;
  const nothing = data && data.sources.length === 0 && counts && counts.not_assessed >= data.controls.length - 1;

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="Compliance"
        description="Your scan results mapped to CIS Controls, PCI DSS, ISO 27001, and SOC 2. It covers what can be seen from outside, using scans from the last 30 days, so treat it as evidence for an audit rather than a certification."
        status={
          counts && !nothing ? (
            <RunStatus tone={counts.fail ? "error" : counts.warn ? "idle" : "done"} label={counts.fail ? `${counts.fail} failing` : counts.warn ? `${counts.warn} need attention` : "No failing controls"} />
          ) : null
        }
      />

      {report.isError ? (
        <p className="text-[13px] text-[#ff8fb3]">{(report.error as ApiError).message}</p>
      ) : nothing ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--lp-border)] px-6 py-12 text-center">
          <ClipboardCheck className="h-6 w-6 text-[var(--lp-subtle)]" />
          <p className="mt-3 text-[14px] text-[var(--lp-muted)]">No evidence yet</p>
          <p className="mt-1 max-w-md text-[13px] text-[var(--lp-subtle)]">
            Controls are assessed from your scans. Run a passive check on a domain to start, then verify it and scan its attack surface for the rest.
          </p>
          <Link href="/passive-checks" className="console-btn console-btn-primary mt-4 h-9 px-4">
            Go to Passive checks
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(data?.frameworks ?? []).map((fw) => (
              <FrameworkCard key={fw.id} fw={fw} active={framework === fw.id} onClick={() => setFramework((f) => (f === fw.id ? "" : fw.id))} />
            ))}
          </div>

          <Panel
            title={framework ? `Controls mapped to ${data?.frameworks.find((f) => f.id === framework)?.name ?? ""}` : "Controls"}
            bodyClassName="p-0"
            aside={
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg border border-[var(--lp-border)] p-0.5" role="tablist" aria-label="Filter by status">
                  {(["all", ...statusOrder] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="tab"
                      aria-selected={status === s}
                      onClick={() => setStatus(s)}
                      className={cn("rounded-md px-2.5 py-1 text-[12px]", status === s ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]")}
                    >
                      {s === "all" ? "All" : statusMeta[s].label}
                      {s !== "all" && counts ? <span className="ml-1 text-[var(--lp-subtle)]">{counts[s]}</span> : null}
                    </button>
                  ))}
                </div>
                <a href="/api/security/compliance?format=csv" download className="console-btn console-btn-secondary h-8 gap-1.5 px-3 text-[12px]">
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </a>
              </div>
            }
          >
            {report.isLoading ? (
              <p className="px-4 pb-4 text-[13px] text-[var(--lp-subtle)]">Loading…</p>
            ) : controls.length ? (
              <ul className="border-t border-[var(--lp-border)]">
                {controls.map((c) => (
                  <ControlRow key={c.id} control={c} framework={framework} frameworks={data?.frameworks ?? []} />
                ))}
              </ul>
            ) : (
              <p className="border-t border-[var(--lp-border)] px-4 py-8 text-center text-[13px] text-[var(--lp-subtle)]">No controls match this filter.</p>
            )}
          </Panel>

          {data?.sources.length ? (
            <Panel title="Evidence sources">
              <p className="mb-2 text-[12px] text-[var(--lp-subtle)]">The newest finished scan of each kind for each domain, from the last {data.window_days} days. Assessed {formatDateTime(data.checked_at)}.</p>
              <ul className="grid gap-1 text-[12px]">
                {data.sources.map((s) => (
                  <li key={`${s.kind}-${s.scan_id}`} className="flex flex-wrap gap-x-2">
                    <span className="lp-mono text-[var(--lp-text)]">{s.domain}</span>
                    <span className="text-[var(--lp-muted)]">{{ passive: "Passive check", surface: "Attack surface scan", deep: "Deep scan" }[s.kind] ?? s.kind}</span>
                    <span className="text-[var(--lp-subtle)]">
                      #{s.scan_id}, {formatDateTime(s.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </>
      )}
    </div>
  );
}
