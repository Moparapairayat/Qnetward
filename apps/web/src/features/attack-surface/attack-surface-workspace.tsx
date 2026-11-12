"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Radar, Trash2 } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { SecurityScan, SurfaceFinding, SurfaceHost, SurfaceReport, VerifiedDomainListResponse } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { Field, PageHeader, Panel, RunStatus } from "@/components/tools/probe-ui";
import { GradeBadge, ago, severityMeta } from "@/features/passive-checks/passive-checks-workspace";

// Ports whose exposure is a problem, so their chips stand out.
const riskyPorts = new Set([21, 23, 445, 1433, 1521, 2375, 3306, 3389, 5432, 5900, 6379, 9200, 11211, 27017]);

function SurfaceFindingRow({ finding }: { finding: SurfaceFinding }) {
  const [open, setOpen] = useState(finding.severity === "high");
  const meta = severityMeta[finding.severity];
  return (
    <li className="border-t border-[var(--lp-border)] first:border-t-0">
      <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.015]" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={cn("mt-px shrink-0 rounded-md border px-1.5 py-px text-[11px]", meta.pill)}>{meta.label}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] text-[var(--lp-text)]">{finding.title}</span>
          <span className="lp-mono block truncate text-[11px] text-[var(--lp-subtle)]">{finding.host}</span>
        </span>
        <ChevronDown className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--lp-subtle)] transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="grid gap-2 px-4 pb-3.5 pl-[4.6rem] text-[13px] leading-relaxed">
          {finding.detail ? <p className="text-[var(--lp-muted)]">{finding.detail}</p> : null}
          {finding.fix ? (
            <p className="rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2 text-[var(--lp-muted)]">
              <span className="text-[var(--lp-text)]">Fix: </span>
              {finding.fix}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function daysUntil(value?: string | null) {
  return value ? Math.floor((new Date(value).getTime() - Date.now()) / 86_400_000) : null;
}

function HostRow({ host, isNew, newPorts }: { host: SurfaceHost; isNew: boolean; newPorts: Set<number> }) {
  const days = daysUntil(host.cert_expiry);
  return (
    <tr className="border-t border-[var(--lp-border)] align-top">
      <td className="min-w-0 px-4 py-2.5">
        <p className="lp-mono break-all text-[12px] text-[var(--lp-text)]">
          {host.name}
          {isNew ? <span className="ml-2 rounded border border-[rgba(96,165,250,0.35)] px-1 font-sans text-[10px] text-[#93c5fd]">New</span> : null}
        </p>
        <p className="text-[11px] text-[var(--lp-subtle)]">
          {host.source}
          {host.cname ? ` · CNAME ${host.cname}` : ""}
        </p>
      </td>
      <td className="lp-mono hidden px-3 py-2.5 text-[11px] text-[var(--lp-muted)] md:table-cell">
        {host.addresses.length ? host.addresses.slice(0, 2).join(", ") + (host.addresses.length > 2 ? ` +${host.addresses.length - 2}` : "") : "—"}
        {host.private ? <span className="ml-1 font-sans text-[#fbbf24]">private, not probed</span> : null}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap gap-1">
          {host.open_ports.length ? (
            host.open_ports.map((p) => (
              <span
                key={p}
                className={cn(
                  "lp-mono rounded border px-1.5 text-[11px]",
                  riskyPorts.has(p) ? "border-[rgba(255,61,127,0.35)] text-[#ff8fb3]" : "border-[var(--lp-border)] text-[var(--lp-muted)]",
                  newPorts.has(p) && "ring-1 ring-[rgba(96,165,250,0.6)]",
                )}
                title={newPorts.has(p) ? "Open since the last scan" : undefined}
              >
                {p}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-[var(--lp-subtle)]">{host.private || !host.addresses.length ? "—" : "None open"}</span>
          )}
        </div>
      </td>
      <td className="hidden px-4 py-2.5 text-right text-[11px] lg:table-cell">
        {days !== null ? (
          <span className={cn(days < 14 ? "text-[#ff8fb3]" : days < 30 ? "text-[#fbbf24]" : "text-[var(--lp-muted)]")} title={host.cert_issuer}>
            {days < 0 ? "Expired" : `${days}d left`}
          </span>
        ) : (
          <span className="text-[var(--lp-subtle)]">—</span>
        )}
      </td>
    </tr>
  );
}

function SurfaceReportView({ report, previous }: { report: SurfaceReport; previous?: SurfaceReport }) {
  const [showInfo, setShowInfo] = useState(false);
  const before = useMemo(() => new Map((previous?.hosts ?? []).map((h) => [h.name, new Set(h.open_ports)])), [previous]);
  const issues = report.findings.filter((f) => f.severity !== "info" && f.severity !== "pass");
  const info = report.findings.filter((f) => f.severity === "info");
  const openPorts = report.hosts.reduce((n, h) => n + h.open_ports.length, 0);
  const newHosts = previous ? report.hosts.filter((h) => !before.has(h.name)).length : 0;

  return (
    <div className="grid gap-5 [&>*]:min-w-0">
      <section className="flex flex-col gap-5 rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-5 sm:flex-row sm:items-center">
        <GradeBadge grade={report.grade} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[18px] font-medium">{report.domain}</p>
          <p className="mt-0.5 text-[13px] text-[var(--lp-muted)]">
            {report.hosts.length} host{report.hosts.length === 1 ? "" : "s"} · {openPorts} open port{openPorts === 1 ? "" : "s"} · scanned {formatDateTime(report.checked_at)} in{" "}
            {Math.round(report.duration_ms / 1000)}s
            {previous ? <span className="ml-2 text-[#93c5fd]">{newHosts ? `${newHosts} new host${newHosts === 1 ? "" : "s"} since last scan` : "no new hosts since last scan"}</span> : null}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["high", "medium", "low"] as const).map((s) => (
              <span key={s} className={cn("rounded-md border px-2 py-0.5 text-[12px]", severityMeta[s].pill, !report.counts[s] && "opacity-40")}>
                {report.counts[s] ?? 0} {severityMeta[s].label.toLowerCase()}
              </span>
            ))}
          </div>
          {report.truncated ? <p className="mt-2 text-[12px] text-[#fbbf24]">Only the first 100 names were scanned.</p> : null}
          {report.ct_error ? <p className="mt-2 text-[12px] text-[var(--lp-subtle)]">Certificate logs weren&apos;t reachable ({report.ct_error}), so only common names were tried.</p> : null}
        </div>
      </section>

      <Panel title="Findings" bodyClassName="p-0">
        {issues.length ? (
          <ul className="border-t border-[var(--lp-border)]">
            {issues.map((f, i) => (
              <SurfaceFindingRow key={`${f.host}-${f.id}-${i}`} finding={f} />
            ))}
          </ul>
        ) : (
          <p className="border-t border-[var(--lp-border)] px-4 py-6 text-center text-[13px] text-[#86efac]">Nothing exposed that shouldn&apos;t be.</p>
        )}
        {info.length ? (
          <div className="border-t border-[var(--lp-border)]">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[12px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
              onClick={() => setShowInfo((v) => !v)}
              aria-expanded={showInfo}
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showInfo && "rotate-180")} />
              {info.length} note{info.length === 1 ? "" : "s"}
            </button>
            {showInfo ? (
              <ul>
                {info.map((f, i) => (
                  <SurfaceFindingRow key={`${f.host}-${f.id}-${i}`} finding={f} />
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Panel>

      <Panel title="Hosts" bodyClassName="p-0">
        <div className="overflow-x-auto border-t border-[var(--lp-border)]">
          <table className="w-full min-w-[520px] text-left">
            <thead className="text-[11px] uppercase tracking-[0.06em] text-[var(--lp-subtle)]">
              <tr>
                <th className="px-4 py-2 font-normal">Name</th>
                <th className="hidden px-3 py-2 font-normal md:table-cell">Addresses</th>
                <th className="px-3 py-2 font-normal">Open ports</th>
                <th className="hidden px-4 py-2 text-right font-normal lg:table-cell">Certificate</th>
              </tr>
            </thead>
            <tbody>
              {report.hosts.map((h) => {
                const old = before.get(h.name);
                return <HostRow key={h.name} host={h} isNew={Boolean(previous) && !old} newPorts={old ? new Set(h.open_ports.filter((p) => !old.has(p))) : new Set()} />;
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

export function AttackSurfaceWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState("");

  const domainsQuery = useQuery({ queryKey: ["asset-domains"], queryFn: () => apiRequest<VerifiedDomainListResponse>("/api/assets/domains") });
  const verified = useMemo(() => (domainsQuery.data?.domains ?? []).filter((d) => d.status === "verified"), [domainsQuery.data]);
  const target = domain || verified[0]?.domain || "";

  const history = useQuery({
    queryKey: ["surface-scans"],
    queryFn: () => apiRequest<{ scans: SecurityScan[] }>("/api/security/surface?limit=30"),
    // Poll while a scan runs.
    refetchInterval: (q) => (q.state.data?.scans.some((s) => s.status === "running") ? 4000 : false),
  });
  const scans = useMemo(() => history.data?.scans ?? [], [history.data]);
  const running = scans.find((s) => s.status === "running");
  const selectedId = Number(params.get("scan")) || scans.find((s) => s.status === "done")?.id || null;

  const selected = useQuery({
    queryKey: ["surface-scan", selectedId],
    queryFn: () => apiRequest<SecurityScan>(`/api/security/surface?id=${selectedId}`),
    enabled: selectedId !== null && scans.find((s) => s.id === selectedId)?.status === "done",
    staleTime: Infinity,
  });
  const current = selected.data;
  const previousScan = current ? scans.find((s) => s.status === "done" && s.domain === current.domain && new Date(s.created_at) < new Date(current.created_at)) : undefined;
  const previous = useQuery({
    queryKey: ["surface-scan", previousScan?.id],
    queryFn: () => apiRequest<SecurityScan>(`/api/security/surface?id=${previousScan!.id}`),
    enabled: Boolean(previousScan),
    staleTime: Infinity,
  });

  // When a running scan finishes, open it.
  const [watching, setWatching] = useState<number | null>(null);
  useEffect(() => {
    if (!watching) return;
    const s = scans.find((x) => x.id === watching);
    if (s && s.status !== "running") {
      setWatching(null); // eslint-disable-line react-hooks/set-state-in-effect
      router.replace(`/attack-surface?scan=${s.id}`, { scroll: false });
    }
  }, [scans, watching, router]);

  const start = useMutation({
    mutationFn: (d: string) => apiRequest<SecurityScan>("/api/security/surface", { method: "POST", body: JSON.stringify({ domain: d }) }),
    onSuccess: async (scan) => {
      setWatching(scan.id);
      await queryClient.invalidateQueries({ queryKey: ["surface-scans"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => apiRequest(`/api/security/surface?id=${id}`, { method: "DELETE" }),
    onSuccess: async (_, id) => {
      if (id === selectedId) router.replace("/attack-surface", { scroll: false });
      await queryClient.invalidateQueries({ queryKey: ["surface-scans"] });
    },
  });

  const failed = watching === null ? undefined : scans.find((s) => s.id === watching && s.status === "failed");

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="Attack surface"
        description="Map what your verified domains expose: subdomains from certificate logs and common names, the service ports open on each, and certificates about to expire. Exposed databases and subdomains open to takeover are flagged first."
        status={running ? <RunStatus tone="live" label={`Scanning ${running.domain}…`} /> : current ? <RunStatus tone={current.high ? "error" : "done"} label={`${current.domain}: ${current.grade}`} /> : null}
      />

      {domainsQuery.isSuccess && verified.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--lp-border)] px-6 py-12 text-center">
          <Radar className="h-6 w-6 text-[var(--lp-subtle)]" />
          <p className="mt-3 text-[14px] text-[var(--lp-muted)]">Verify a domain first</p>
          <p className="mt-1 max-w-md text-[13px] text-[var(--lp-subtle)]">
            Attack surface scans probe ports, so they only run on domains you&apos;ve proved you control.
          </p>
          <Link href="/assets" className="console-btn console-btn-primary mt-4 h-9 px-4">
            Go to Assets
          </Link>
        </div>
      ) : (
        <form
          className="rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (target) start.mutate(target);
          }}
        >
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <Field label="Verified domain">
              <select id="surface-domain" className="h-10 w-full px-3" value={target} onChange={(e) => setDomain(e.target.value)}>
                {verified.map((d) => (
                  <option key={d.id} value={d.domain}>
                    {d.domain}
                  </option>
                ))}
              </select>
            </Field>
            <button type="submit" className="console-btn console-btn-primary h-10 px-5" disabled={!target || start.isPending || Boolean(running)}>
              {running ? "Scan running…" : start.isPending ? "Starting…" : "Scan"}
            </button>
          </div>
          {start.isError ? (
            <p className="mt-3 rounded-lg border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] px-3 py-2.5 text-[13px] text-[#ff8fb3]" role="alert">
              {(start.error as ApiError).message}
            </p>
          ) : failed ? (
            <p className="mt-3 rounded-lg border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] px-3 py-2.5 text-[13px] text-[#ff8fb3]" role="alert">
              The scan failed: {failed.error}
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-[var(--lp-subtle)]">Takes one to three minutes. You can leave this page; the result is saved.</p>
          )}
        </form>
      )}

      <div className="grid grid-cols-1 items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_280px] [&>*]:min-w-0">
        <div className="min-w-0">
          {running && (!current || watching) ? (
            <div className="flex flex-col items-center rounded-xl border border-[var(--lp-border)] px-6 py-14 text-center">
              <span className="lp-pulse h-3 w-3 rounded-full bg-[var(--lp-accent)]" />
              <p className="mt-4 text-[14px] text-[var(--lp-text)]">Scanning {running.domain}</p>
              <p className="mt-1 max-w-md text-[13px] text-[var(--lp-subtle)]">
                Reading certificate logs, resolving names, and checking 20 service ports on each host. Started {ago(running.created_at)}.
              </p>
            </div>
          ) : current?.report && "hosts" in current.report ? (
            <SurfaceReportView key={current.id} report={current.report as unknown as SurfaceReport} previous={previous.data?.report as unknown as SurfaceReport | undefined} />
          ) : selected.isLoading ? (
            <p className="rounded-xl border border-[var(--lp-border)] px-4 py-10 text-center text-[13px] text-[var(--lp-subtle)]">Loading report…</p>
          ) : verified.length ? (
            <p className="rounded-xl border border-dashed border-[var(--lp-border)] px-4 py-12 text-center text-[13px] text-[var(--lp-subtle)]">Run your first scan to see what your domain exposes.</p>
          ) : null}
        </div>

        <Panel title="Scans" bodyClassName="p-0">
          {scans.length ? (
            <ul className="border-t border-[var(--lp-border)]">
              {scans.map((s) => (
                <li key={s.id} className={cn("group flex items-center gap-3 border-b border-[var(--lp-border)] px-3 py-2.5 last:border-b-0", s.id === selectedId && "bg-white/[0.04]")}>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    disabled={s.status !== "done"}
                    onClick={() => router.replace(`/attack-surface?scan=${s.id}`, { scroll: false })}
                  >
                    {s.status === "done" ? (
                      <GradeBadge grade={s.grade} size="sm" />
                    ) : (
                      <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-[10px]", s.status === "running" ? "border-[var(--lp-border)] text-[var(--lp-subtle)]" : "border-[rgba(255,61,127,0.35)] text-[#ff8fb3]")}>
                        {s.status === "running" ? "…" : "!"}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] text-[var(--lp-text)]">{s.domain}</span>
                      <span className="block text-[11px] text-[var(--lp-subtle)]" title={formatDateTime(s.created_at)}>
                        {s.status === "running" ? "Running" : s.status === "failed" ? "Failed" : ago(s.created_at)}
                        {s.high ? <span className="text-[#ff8fb3]"> · {s.high} high</span> : null}
                      </span>
                    </span>
                  </button>
                  {s.status !== "running" ? (
                    <button
                      type="button"
                      className="rounded p-1 text-[var(--lp-subtle)] opacity-0 hover:text-[#ff8fb3] focus:opacity-100 group-hover:opacity-100"
                      aria-label={`Delete the ${s.domain} scan`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(s.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-[var(--lp-border)] px-4 py-4 text-[13px] text-[var(--lp-subtle)]">{history.isLoading ? "Loading…" : "No scans yet."}</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
