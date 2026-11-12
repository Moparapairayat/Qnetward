"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, ShieldAlert } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { VulnListResponse, VulnSeverity, VulnView } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { PageHeader, Panel, RunStatus, StatStrip } from "@/components/tools/probe-ui";

const sevMeta: Record<VulnSeverity, { label: string; pill: string }> = {
  critical: { label: "Critical", pill: "border-[rgba(255,61,127,0.45)] bg-[rgba(255,61,127,0.15)] text-[#ff8fb3]" },
  high: { label: "High", pill: "border-[rgba(251,146,60,0.35)] bg-[rgba(251,146,60,0.1)] text-[#fdba74]" },
  medium: { label: "Medium", pill: "border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.08)] text-[#fcd34d]" },
  low: { label: "Low", pill: "border-[rgba(96,165,250,0.3)] bg-[rgba(96,165,250,0.08)] text-[#93c5fd]" },
};
const severities = Object.keys(sevMeta) as VulnSeverity[];

const decisionLabel = { accepted: "Risk accepted", false_positive: "False positive" } as const;

function VulnRow({ vuln, canDecide }: { vuln: VulnView; canDecide: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [choosing, setChoosing] = useState<"accepted" | "false_positive" | null>(null);
  const [reason, setReason] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["vulnerabilities"] });

  const decide = useMutation({
    mutationFn: () =>
      apiRequest("/api/security/vulnerabilities/decisions", {
        method: "POST",
        body: JSON.stringify({ host: vuln.host, cve: vuln.cve, status: choosing, reason: reason.trim() }),
      }),
    onSuccess: async () => {
      setChoosing(null);
      setReason("");
      await refresh();
    },
  });
  const undo = useMutation({
    mutationFn: () => apiRequest(`/api/security/vulnerabilities/decisions?id=${vuln.disposition?.id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const meta = sevMeta[vuln.severity] ?? sevMeta.low;
  const decided = vuln.disposition;

  return (
    <li className={cn("border-t border-[var(--lp-border)] first:border-t-0", decided && "opacity-60")}>
      <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.015]" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={cn("mt-px w-[68px] shrink-0 rounded-md border px-1.5 py-px text-center text-[11px]", meta.pill)}>{meta.label}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="lp-mono text-[13px] text-[var(--lp-text)]">{vuln.cve}</span>
            {vuln.kev ? <span className="rounded border border-[rgba(255,61,127,0.45)] px-1 text-[10px] font-medium text-[#ff8fb3]">Exploited in the wild</span> : null}
            {decided ? <span className="rounded border border-[var(--lp-border)] px-1 text-[10px] text-[var(--lp-muted)]">{decisionLabel[decided.status]}</span> : null}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-[var(--lp-muted)]">
            {vuln.product} {vuln.version} on <span className="lp-mono">{vuln.host}:{vuln.port}</span>
          </span>
        </span>
        <span className="hidden shrink-0 text-right sm:block">
          <span className="lp-mono block text-[13px] text-[var(--lp-text)]">{vuln.cvss ? vuln.cvss.toFixed(1) : "—"}</span>
          <span className="block text-[11px] text-[var(--lp-subtle)]" title="Chance of exploitation in the next 30 days (EPSS)">
            {vuln.epss ? `${(vuln.epss * 100).toFixed(vuln.epss < 0.01 ? 2 : 0)}% EPSS` : "—"}
          </span>
        </span>
        <ChevronDown className={cn("mt-1 h-3.5 w-3.5 shrink-0 text-[var(--lp-subtle)] transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="grid gap-3 px-4 pb-4 pl-[5.6rem] text-[13px] leading-relaxed">
          <p className="text-[var(--lp-muted)]">{vuln.summary || "No description published yet."}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--lp-subtle)]">
            {vuln.published ? <span>Published {vuln.published}</span> : null}
            <span>Seen in the scan of {vuln.domain} on {formatDateTime(vuln.scanned_at)}</span>
            <a className="inline-flex items-center gap-1 text-[var(--lp-text)] hover:underline" href={vuln.url} target="_blank" rel="noreferrer">
              NVD entry <ArrowUpRight className="h-3 w-3" />
            </a>
          </p>
          {decided ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2 text-[12px] text-[var(--lp-muted)]">
              <span>
                {decisionLabel[decided.status]} on {formatDateTime(decided.created_at)}
                {decided.reason ? `: ${decided.reason}` : ""}
              </span>
              {canDecide ? (
                <button type="button" className="text-[var(--lp-text)] hover:underline" disabled={undo.isPending} onClick={() => undo.mutate()}>
                  Reopen
                </button>
              ) : null}
            </div>
          ) : canDecide ? (
            choosing ? (
              <form
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  decide.mutate();
                }}
              >
                <input
                  className="h-8 w-full px-2.5 text-[12px]"
                  placeholder={choosing === "accepted" ? "Why the risk is acceptable" : "Why it doesn't apply, e.g. patched by the distribution"}
                  maxLength={500}
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <button type="submit" className="console-btn console-btn-primary h-8 px-3" disabled={decide.isPending}>
                  {decide.isPending ? "Saving…" : `Mark as ${decisionLabel[choosing].toLowerCase()}`}
                </button>
                <button type="button" className="console-btn console-btn-secondary h-8 px-3" onClick={() => setChoosing(null)}>
                  Cancel
                </button>
                {decide.isError ? <p className="text-[12px] text-[#ff8fb3] sm:col-span-3">{(decide.error as ApiError).message}</p> : null}
              </form>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="console-btn console-btn-secondary h-8 px-3" onClick={() => setChoosing("accepted")}>
                  Accept risk
                </button>
                <button type="button" className="console-btn console-btn-secondary h-8 px-3" onClick={() => setChoosing("false_positive")}>
                  False positive
                </button>
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function VulnerabilitiesWorkspace() {
  const [severity, setSeverity] = useState<VulnSeverity | "all">("all");
  const [showDecided, setShowDecided] = useState(false);
  const [query, setQuery] = useState("");

  const list = useQuery({ queryKey: ["vulnerabilities"], queryFn: () => apiRequest<VulnListResponse>("/api/security/vulnerabilities") });
  const workspace = useQuery({ queryKey: ["workspace-general"], queryFn: () => apiRequest<{ workspace: { role: string } }>("/api/workspace") });
  const canDecide = ["owner", "admin"].includes(workspace.data?.workspace.role ?? "");

  const vulns = useMemo(() => list.data?.vulns ?? [], [list.data]);
  const open = vulns.filter((v) => !v.disposition);
  const count = (s: VulnSeverity) => open.filter((v) => v.severity === s).length;
  const exploited = open.filter((v) => v.kev).length;
  const q = query.trim().toLowerCase();
  const shown = vulns.filter(
    (v) =>
      (showDecided || !v.disposition) &&
      (severity === "all" || v.severity === severity) &&
      (!q || `${v.cve} ${v.host} ${v.product} ${v.version}`.toLowerCase().includes(q)),
  );
  const domains = list.data?.domains ?? [];
  const lookupErrors = domains.filter((d) => d.vuln_error);

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="Vulnerabilities"
        description="Known vulnerabilities in the software your verified domains run, matched from the versions their services announce during attack surface scans. Ranked by what attackers actually use, then by severity."
        status={
          vulns.length ? (
            <RunStatus tone={count("critical") ? "error" : "done"} label={exploited ? `${exploited} exploited in the wild` : `${open.length} open`} />
          ) : null
        }
      />

      {list.isSuccess && domains.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--lp-border)] px-6 py-12 text-center">
          <ShieldAlert className="h-6 w-6 text-[var(--lp-subtle)]" />
          <p className="mt-3 text-[14px] text-[var(--lp-muted)]">No attack surface scans yet</p>
          <p className="mt-1 max-w-md text-[13px] text-[var(--lp-subtle)]">Vulnerabilities come from the software found on your hosts. Scan a verified domain to see them here.</p>
          <Link href="/attack-surface" className="console-btn console-btn-primary mt-4 h-9 px-4">
            Go to Attack surface
          </Link>
        </div>
      ) : (
        <>
          <StatStrip
            items={[
              { label: "Critical", value: String(count("critical")), tone: count("critical") ? "bad" : undefined },
              { label: "High", value: String(count("high")), tone: count("high") ? "warn" : undefined },
              { label: "Medium", value: String(count("medium")) },
              { label: "Low", value: String(count("low")) },
              { label: "Exploited", value: String(exploited), tone: exploited ? "bad" : undefined },
              { label: "Decided", value: String(vulns.length - open.length) },
            ]}
          />
          <p className="rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--lp-muted)]">
            Matched from the version each service announces. Linux distributions often fix vulnerabilities without changing the version number, so check the package
            before acting, and mark ones that don&apos;t apply as false positives.
            {lookupErrors.length ? <span className="text-[#fbbf24]"> Some lookups failed in the last scan; scan again to complete them.</span> : null}
          </p>

          <Panel
            title="Findings"
            bodyClassName="p-0"
            aside={
              <div className="flex flex-wrap items-center gap-2">
                <input className="h-8 w-44 px-2.5 text-[12px]" placeholder="Search CVE, host, product" value={query} onChange={(e) => setQuery(e.target.value)} />
                <div className="flex rounded-lg border border-[var(--lp-border)] p-0.5" role="tablist" aria-label="Filter by severity">
                  {(["all", ...severities] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="tab"
                      aria-selected={severity === s}
                      onClick={() => setSeverity(s)}
                      className={cn("rounded-md px-2.5 py-1 text-[12px]", severity === s ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]")}
                    >
                      {s === "all" ? "All" : sevMeta[s].label}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1.5 text-[12px] text-[var(--lp-muted)]">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--lp-accent)]" checked={showDecided} onChange={(e) => setShowDecided(e.target.checked)} />
                  Show decided
                </label>
              </div>
            }
          >
            {list.isLoading ? (
              <p className="px-4 pb-4 text-[13px] text-[var(--lp-subtle)]">Loading…</p>
            ) : shown.length ? (
              <ul className="border-t border-[var(--lp-border)]">
                {shown.slice(0, 300).map((v) => (
                  <VulnRow key={`${v.host}-${v.port}-${v.cve}`} vuln={v} canDecide={canDecide} />
                ))}
              </ul>
            ) : (
              <p className="border-t border-[var(--lp-border)] px-4 py-8 text-center text-[13px] text-[#86efac]">
                {vulns.length ? "Nothing matches these filters." : "No known vulnerabilities in the software found."}
              </p>
            )}
            {shown.length > 300 ? <p className="border-t border-[var(--lp-border)] px-4 py-2.5 text-[12px] text-[var(--lp-subtle)]">Showing the 300 most serious of {shown.length}.</p> : null}
          </Panel>
        </>
      )}
    </div>
  );
}
