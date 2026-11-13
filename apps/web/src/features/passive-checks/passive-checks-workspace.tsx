"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  ChevronDown,
  Globe,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "@/components/icons";
import type { AppIcon } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type {
  FindingCategory,
  PassiveReport,
  SecurityFinding,
  SecurityScan,
  SecurityWatch,
  SecurityWatchListResponse,
  SessionResponse,
  Severity,
} from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { useLiveInterval } from "@/lib/live";
import {
  Field,
  PageHeader,
  Panel,
  RunStatus,
  Toggle,
} from "@/components/tools/probe-ui";

export const severityMeta: Record<
  Severity,
  { label: string; color: string; pill: string }
> = {
  high: {
    label: "High",
    color: "#ff3d7f",
    pill: "border-[rgba(255,61,127,0.35)] bg-[rgba(255,61,127,0.1)] text-[#ff8fb3]",
  },
  medium: {
    label: "Medium",
    color: "#fb923c",
    pill: "border-[rgba(251,146,60,0.35)] bg-[rgba(251,146,60,0.1)] text-[#fdba74]",
  },
  low: {
    label: "Low",
    color: "#fbbf24",
    pill: "border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.08)] text-[#fcd34d]",
  },
  info: {
    label: "Info",
    color: "#60a5fa",
    pill: "border-[rgba(96,165,250,0.3)] bg-[rgba(96,165,250,0.08)] text-[#93c5fd]",
  },
  pass: {
    label: "Passed",
    color: "#4ade80",
    pill: "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]",
  },
};

const categoryMeta: Record<FindingCategory, { label: string; icon: AppIcon }> =
  {
    tls: { label: "TLS & certificate", icon: Lock },
    http: { label: "Website headers", icon: Globe },
    email: { label: "Email spoofing", icon: Mail },
    dns: { label: "DNS", icon: ShieldCheck },
  };
const categories = Object.keys(categoryMeta) as FindingCategory[];

function gradeColor(grade: string) {
  if (grade.startsWith("A")) return "#4ade80";
  if (grade === "B") return "#a3e635";
  if (grade === "C") return "#fbbf24";
  if (grade === "D") return "#fb923c";
  return "#ff3d7f";
}

const intervalLabel: Record<number, string> = {
  6: "Every 6 hours",
  24: "Daily",
  168: "Weekly",
};

/** "5m ago", or with future, "in 5h". */
export function ago(value: string, future = false) {
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const s = Math.max(0, Math.round(future ? diff : -diff));
  const text =
    s < 3600
      ? `${Math.round(s / 60)}m`
      : s < 86400
        ? `${Math.round(s / 3600)}h`
        : `${Math.round(s / 86400)}d`;
  if (future) return s < 60 ? "soon" : `in ${text}`;
  return s < 60 ? "just now" : `${text} ago`;
}

export function GradeBadge({
  grade,
  size = "lg",
}: {
  grade: string;
  size?: "lg" | "sm";
}) {
  const color = gradeColor(grade);
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-xl border font-semibold tracking-[-0.03em]",
        size === "lg"
          ? "h-20 w-20 text-3xl"
          : "h-8 w-8 rounded-lg text-base",
      )}
      style={{ color, borderColor: `${color}55`, background: `${color}14` }}
      aria-label={`Grade ${grade}`}
    >
      {grade}
    </span>
  );
}

/** Label and value rows whose long values (SPF, DMARC) wrap instead of widening the page. */
function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-[var(--lp-border)] text-sm">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
        >
          <dt className="shrink-0 text-[var(--lp-subtle)]">{item.label}</dt>
          <dd className="min-w-0 text-right break-words text-[var(--lp-text)]">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FindingRow({ finding }: { finding: SecurityFinding }) {
  const [open, setOpen] = useState(finding.severity === "high");
  const meta = severityMeta[finding.severity];
  const expandable = Boolean(finding.detail || finding.fix);
  return (
    <li className="border-t border-[var(--lp-border)] first:border-t-0">
      <button
        type="button"
        className={cn(
          "flex w-full items-start gap-3 px-4 py-3 text-left",
          expandable && "hover:bg-white/[0.015]",
        )}
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
      >
        <span
          className={cn(
            "mt-px shrink-0 rounded-md border px-1.5 py-px text-2xs",
            meta.pill,
          )}
        >
          {meta.label}
        </span>
        <span className="min-w-0 flex-1 text-sm text-[var(--lp-text)]">
          {finding.title}
        </span>
        {expandable ? (
          <ChevronDown
            className={cn(
              "mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--lp-subtle)] transition-transform",
              open && "rotate-180",
            )}
          />
        ) : null}
      </button>
      {open && expandable ? (
        <div className="grid gap-2 px-4 pb-3.5 pl-[4.6rem] text-sm leading-relaxed">
          {finding.detail ? (
            <p className="text-[var(--lp-muted)]">{finding.detail}</p>
          ) : null}
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

function ReportView({
  report,
  previous,
  watchSlot,
}: {
  report: PassiveReport;
  previous?: SecurityScan;
  watchSlot?: ReactNode;
}) {
  const [filter, setFilter] = useState<FindingCategory | "all">("all");
  const [showPassed, setShowPassed] = useState(false);
  const issues = report.findings.filter(
    (f) => f.severity !== "pass" && (filter === "all" || f.category === filter),
  );
  const passed = report.findings.filter(
    (f) => f.severity === "pass" && (filter === "all" || f.category === filter),
  );
  const issueCount = (c: FindingCategory) =>
    report.findings.filter(
      (f) => f.category === c && f.severity !== "pass" && f.severity !== "info",
    ).length;
  const delta = previous ? report.score - previous.score : 0;
  const cert = report.tls.cert;

  return (
    <div className="grid gap-5 [&>*]:min-w-0">
      <section className="flex flex-col gap-5 rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-5 sm:flex-row sm:items-center">
        <GradeBadge grade={report.grade} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-medium">{report.domain}</p>
          <p className="mt-0.5 text-sm text-[var(--lp-muted)]">
            Score{" "}
            <span className="lp-mono text-[var(--lp-text)]">
              {report.score}
            </span>
            /100 · checked {formatDateTime(report.checked_at)} in{" "}
            {(report.duration_ms / 1000).toFixed(1)}s
            {previous ? (
              <span
                className={cn(
                  "ml-2",
                  delta > 0
                    ? "text-[#86efac]"
                    : delta < 0
                      ? "text-[#ff8fb3]"
                      : "text-[var(--lp-subtle)]",
                )}
              >
                {delta === 0 ? "no change" : `${delta > 0 ? "+" : ""}${delta}`}{" "}
                since {ago(previous.created_at)} ({previous.grade})
              </span>
            ) : null}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["high", "medium", "low", "info"] as const).map((s) => (
              <span
                key={s}
                className={cn(
                  "rounded-md border px-2 py-0.5 text-xs",
                  severityMeta[s].pill,
                  !report.counts[s] && "opacity-40",
                )}
              >
                {report.counts[s] ?? 0} {severityMeta[s].label.toLowerCase()}
              </span>
            ))}
            <span
              className={cn(
                "rounded-md border px-2 py-0.5 text-xs",
                severityMeta.pass.pill,
              )}
            >
              {report.counts.pass ?? 0} passed
            </span>
          </div>
        </div>
        {watchSlot}
      </section>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)] [&>*]:min-w-0">
        <Panel
          title="Findings"
          bodyClassName="p-0"
          aside={
            <div
              className="flex flex-wrap rounded-lg border border-[var(--lp-border)] p-0.5"
              role="tablist"
              aria-label="Filter findings"
            >
              {(["all", ...categories] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={filter === c}
                  onClick={() => setFilter(c)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs transition-colors",
                    filter === c
                      ? "bg-white/[0.08] text-[var(--lp-text)]"
                      : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]",
                  )}
                >
                  {c === "all" ? "All" : categoryMeta[c].label.split(" ")[0]}
                  {c !== "all" && issueCount(c) ? (
                    <span className="ml-1 text-[#fdba74]">{issueCount(c)}</span>
                  ) : null}
                </button>
              ))}
            </div>
          }
        >
          {issues.length ? (
            <ul className="border-t border-[var(--lp-border)]">
              {issues.map((f) => (
                <FindingRow key={f.id} finding={f} />
              ))}
            </ul>
          ) : (
            <p className="border-t border-[var(--lp-border)] px-4 py-6 text-center text-sm text-[#86efac]">
              Nothing to fix here.
            </p>
          )}
          {passed.length ? (
            <div className="border-t border-[var(--lp-border)]">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
                onClick={() => setShowPassed((v) => !v)}
                aria-expanded={showPassed}
              >
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    showPassed && "rotate-180",
                  )}
                />
                {passed.length} passed check{passed.length === 1 ? "" : "s"}
              </button>
              {showPassed ? (
                <ul>
                  {passed.map((f) => (
                    <FindingRow key={f.id} finding={f} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </Panel>

        <div className="grid gap-5">
          <Panel title="Certificate">
            {cert ? (
              <Facts
                items={[
                  { label: "Issued by", value: cert.issuer || "—" },
                  {
                    label: "Expires",
                    value: (
                      <span
                        className={cn(
                          cert.days_left < 14
                            ? "text-[#ff8fb3]"
                            : cert.days_left < 30 && "text-[#fbbf24]",
                        )}
                      >
                        {formatDateTime(cert.not_after)} ({cert.days_left}d)
                      </span>
                    ),
                  },
                  {
                    label: "Covers",
                    value: (
                      <span className="break-all">
                        {cert.names.slice(0, 6).join(", ") +
                          (cert.names.length > 6
                            ? ` +${cert.names.length - 6}`
                            : "")}
                      </span>
                    ),
                  },
                  {
                    label: "Key",
                    value: `${cert.key_type}${cert.key_bits ? ` ${cert.key_bits}-bit` : ""}`,
                  },
                  {
                    label: "Protocol",
                    value:
                      [report.tls.version, report.tls.cipher]
                        .filter(Boolean)
                        .join(" · ") || "—",
                  },
                  {
                    label: "Trusted",
                    value: report.tls.trusted ? (
                      "Yes"
                    ) : (
                      <span className="text-[#ff8fb3]">
                        {report.tls.trust_error || "No"}
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <p className="text-sm text-[var(--lp-muted)]">
                {report.tls.error
                  ? `No HTTPS: ${report.tls.error}.`
                  : "No certificate was checked."}
              </p>
            )}
          </Panel>

          <Panel title="Email & DNS">
            <Facts
              items={[
                {
                  label: "Mail servers",
                  value: report.dns.mx.length ? (
                    <span className="break-all">
                      {report.dns.mx.map((m) => m.split(" ")[1]).join(", ")}
                    </span>
                  ) : (
                    "None"
                  ),
                },
                {
                  label: "SPF",
                  value: (
                    <span className="lp-mono break-all text-xs">
                      {report.dns.spf[0] ?? "Not set"}
                    </span>
                  ),
                },
                {
                  label: "DMARC",
                  value: (
                    <span className="lp-mono break-all text-xs">
                      {report.dns.dmarc ?? "Not set"}
                      {report.dns.dmarc &&
                      report.dns.dmarc_from &&
                      report.dns.dmarc_from !== report.domain ? (
                        <span className="font-sans text-[var(--lp-subtle)]">
                          {" "}
                          (from {report.dns.dmarc_from})
                        </span>
                      ) : null}
                    </span>
                  ),
                },
                {
                  label: "CAA",
                  value: report.dns.caa.length
                    ? `${report.dns.caa.length} record${report.dns.caa.length === 1 ? "" : "s"}`
                    : "Not set",
                },
                { label: "DNSSEC", value: report.dns.dnssec ? "On" : "Off" },
              ]}
            />
          </Panel>

          {report.http.headers && Object.keys(report.http.headers).length ? (
            <Panel title="Headers seen">
              <dl className="grid gap-2 text-xs">
                {Object.entries(report.http.headers).map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-[var(--lp-subtle)]">{k}</dt>
                    <dd className="lp-mono break-all text-[var(--lp-text)]">
                      {v}
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function PassiveChecksWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState("");
  const selectedId = Number(params.get("scan")) || null;

  useEffect(() => {
    const d = params.get("domain")?.trim();
    // Prefill from links elsewhere in the console.
    if (d) setDomain(d); // eslint-disable-line react-hooks/set-state-in-effect
  }, [params]);

  const history = useQuery({
    queryKey: ["security-scans"],
    queryFn: () =>
      apiRequest<{ scans: SecurityScan[] }>("/api/security/passive?limit=50"),
  });
  const scans = useMemo(() => history.data?.scans ?? [], [history.data]);
  const shownId = selectedId ?? scans[0]?.id ?? null;

  const selected = useQuery({
    queryKey: ["security-scan", shownId],
    queryFn: () =>
      apiRequest<SecurityScan>(`/api/security/passive?id=${shownId}`),
    enabled: shownId !== null,
    staleTime: Infinity,
  });

  const show = (id: number | null) =>
    router.replace(id ? `/passive-checks?scan=${id}` : "/passive-checks", {
      scroll: false,
    });

  const run = useMutation({
    mutationFn: (target: string) =>
      apiRequest<SecurityScan>("/api/security/passive", {
        method: "POST",
        body: JSON.stringify({ domain: target }),
      }),
    onSuccess: async (scan) => {
      queryClient.setQueryData(["security-scan", scan.id], scan);
      await queryClient.invalidateQueries({ queryKey: ["security-scans"] });
      setDomain(scan.domain);
      show(scan.id);
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/api/security/passive?id=${id}`, { method: "DELETE" }),
    onSuccess: async (_, id) => {
      if (id === shownId) show(null);
      await queryClient.invalidateQueries({ queryKey: ["security-scans"] });
    },
  });

  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => apiRequest<SessionResponse>("/api/auth/session"),
  });
  const liveFallback = useLiveInterval(60_000);
  const watchesQuery = useQuery({
    queryKey: ["security-watches"],
    queryFn: () =>
      apiRequest<SecurityWatchListResponse>("/api/security/watches"),
    refetchInterval: liveFallback,
  });
  // The plan's limit counts every watch; this page shows the passive ones.
  const allWatches = watchesQuery.data?.watches ?? [];
  const watches = allWatches.filter((w) => w.kind !== "surface");
  const watchLimit = watchesQuery.data?.limit ?? 0;
  const atWatchLimit = watchLimit > 0 && allWatches.length >= watchLimit;
  const watchFor = (d: string) => watches.find((w) => w.domain === d);
  const [watchError, setWatchError] = useState<string | null>(null);

  const refreshWatches = () =>
    queryClient.invalidateQueries({ queryKey: ["security-watches"] });
  const watch = useMutation({
    mutationFn: (d: string) =>
      apiRequest<SecurityWatch>("/api/security/watches", {
        method: "POST",
        body: JSON.stringify({
          domain: d,
          interval_hours: 24,
          notify_email: session.data?.user?.email ?? "",
        }),
      }),
    onSuccess: () => {
      setWatchError(null);
      return refreshWatches();
    },
    onError: (e: ApiError) => setWatchError(e.message),
  });
  const updateWatch = useMutation({
    mutationFn: (w: SecurityWatch) =>
      apiRequest<SecurityWatch>("/api/security/watches", {
        method: "POST",
        body: JSON.stringify({
          id: w.id,
          interval_hours: w.interval_hours,
          notify_email: w.notify_email,
          enabled: w.enabled,
        }),
      }),
    onSuccess: refreshWatches,
    onError: (e: ApiError) => setWatchError(e.message),
  });
  const unwatch = useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/api/security/watches?id=${id}`, { method: "DELETE" }),
    onSuccess: refreshWatches,
    onError: (e: ApiError) => setWatchError(e.message),
  });

  const current = selected.data;
  const currentWatch = current ? watchFor(current.domain) : undefined;
  // The scan of the same domain before this one, to show what changed.
  const previous = current
    ? scans.find(
        (s) =>
          s.domain === current.domain &&
          new Date(s.created_at) < new Date(current.created_at),
      )
    : undefined;

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="Passive checks"
        description="Grade a domain's security from what anyone can see: its HTTPS certificate and TLS versions, the security headers its site sends, and the DNS records that stop others sending email as it. Nothing intrusive is sent, so no proof of ownership is needed."
        status={
          run.isPending ? (
            <RunStatus tone="live" label="Checking…" />
          ) : current ? (
            <RunStatus
              tone={current.high ? "error" : "done"}
              label={`${current.domain}: ${current.grade}`}
            />
          ) : null
        }
      />

      <form
        className="rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (domain.trim()) run.mutate(domain.trim());
        }}
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <Field label="Domain">
            <input
              id="passive-domain"
              className="h-10 w-full px-3"
              placeholder="example.com"
              autoComplete="off"
              spellCheck={false}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </Field>
          <button
            type="submit"
            className="console-btn console-btn-primary h-10 px-5"
            disabled={run.isPending || !domain.trim()}
          >
            {run.isPending ? "Checking…" : "Run check"}
          </button>
        </div>
        {run.isError ? (
          <p
            className="mt-3 rounded-lg border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] px-3 py-2.5 text-sm text-[#ff8fb3]"
            role="alert"
          >
            {(run.error as ApiError).message}
          </p>
        ) : (
          <p className="mt-2 text-xs text-[var(--lp-subtle)]">
            Takes a few seconds. Each check counts towards your workspace&apos;s
            hourly scans.
          </p>
        )}
      </form>

      <div className="grid grid-cols-1 items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_300px] [&>*]:min-w-0">
        <div className="min-w-0">
          {selected.isLoading ? (
            <p className="rounded-xl border border-[var(--lp-border)] px-4 py-10 text-center text-sm text-[var(--lp-subtle)]">
              Loading report…
            </p>
          ) : current?.report ? (
            <ReportView
              key={current.id}
              report={current.report}
              previous={previous}
              watchSlot={
                currentWatch ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.06)] px-2.5 py-1.5 text-xs text-[#86efac] sm:self-center">
                    <Bell className="h-3.5 w-3.5" /> Watched ·{" "}
                    {intervalLabel[currentWatch.interval_hours].toLowerCase()}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="console-btn console-btn-secondary h-9 shrink-0 self-start px-3 sm:self-center"
                    disabled={watch.isPending || atWatchLimit}
                    title={
                      atWatchLimit
                        ? `Your plan watches up to ${watchLimit} domains`
                        : "Check it again on a schedule and alert when it gets worse"
                    }
                    onClick={() => watch.mutate(current.domain)}
                  >
                    <Bell className="mr-1.5 inline h-3.5 w-3.5" />
                    {watch.isPending ? "Adding…" : "Watch this domain"}
                  </button>
                )
              }
            />
          ) : (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--lp-border)] px-6 py-14 text-center">
              <ShieldCheck className="h-6 w-6 text-[var(--lp-subtle)]" />
              <p className="mt-3 text-base text-[var(--lp-muted)]">
                Check your first domain
              </p>
              <p className="mt-1 max-w-md text-sm text-[var(--lp-subtle)]">
                You&apos;ll get a grade from A+ to F, every issue found with how
                to fix it, and a history to compare against next time.
              </p>
            </div>
          )}
        </div>

        <div className="grid gap-5 [&>*]:min-w-0">
          <WatchList
            watches={watches}
            limit={watchLimit}
            error={watchError}
            busy={updateWatch.isPending || unwatch.isPending}
            onOpen={(id) => show(id)}
            onUpdate={(w) => updateWatch.mutate(w)}
            onRemove={(id) => unwatch.mutate(id)}
          />

          <Panel title="Recent checks" bodyClassName="p-0">
            {scans.length ? (
              <ul className="max-h-[560px] overflow-y-auto border-t border-[var(--lp-border)]">
                {scans.map((s) => (
                  <li
                    key={s.id}
                    className={cn(
                      "group flex items-center gap-3 border-b border-[var(--lp-border)] px-3 py-2.5 last:border-b-0",
                      s.id === shownId && "bg-white/[0.04]",
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      onClick={() => show(s.id)}
                    >
                      <GradeBadge grade={s.grade} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-[var(--lp-text)]">
                          {s.domain}
                        </span>
                        <span
                          className="block text-2xs text-[var(--lp-subtle)]"
                          title={formatDateTime(s.created_at)}
                        >
                          {ago(s.created_at)}
                          {s.high ? (
                            <span className="text-[#ff8fb3]">
                              {" "}
                              · {s.high} high
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-[var(--lp-subtle)] opacity-0 hover:text-[var(--lp-text)] focus:opacity-100 group-hover:opacity-100"
                      aria-label={`Check ${s.domain} again`}
                      title="Check again"
                      disabled={run.isPending}
                      onClick={() => run.mutate(s.domain)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-[var(--lp-subtle)] opacity-0 hover:text-[#ff8fb3] focus:opacity-100 group-hover:opacity-100"
                      aria-label={`Delete the ${s.domain} check`}
                      title="Delete"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(s.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="border-t border-[var(--lp-border)] px-4 py-4 text-sm text-[var(--lp-subtle)]">
                {history.isLoading ? "Loading…" : "No checks yet."}
              </p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** The workspace's watched domains, each with its last grade and schedule. */
export function WatchList({
  watches,
  limit,
  error,
  busy,
  onOpen,
  onUpdate,
  onRemove,
  title = "Watched domains",
  intervals = [6, 24, 168],
  emptyText,
}: {
  watches: SecurityWatch[];
  limit: number;
  error: string | null;
  busy: boolean;
  onOpen: (scanId: number) => void;
  onUpdate: (w: SecurityWatch) => void;
  onRemove: (id: number) => void;
  title?: string;
  intervals?: number[];
  emptyText?: string;
}) {
  return (
    <Panel
      title={title}
      bodyClassName="p-0"
      aside={
        limit ? (
          <span className="text-xs text-[var(--lp-subtle)]">
            {watches.length} of {limit}
          </span>
        ) : null
      }
    >
      {error ? (
        <p
          className="mx-3 mb-3 rounded-lg border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] px-3 py-2 text-xs text-[#ff8fb3]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {watches.length ? (
        <ul className="border-t border-[var(--lp-border)]">
          {watches.map((w) => (
            <li
              key={w.id}
              className="grid gap-2 border-b border-[var(--lp-border)] px-3 py-3 last:border-b-0"
            >
              <div className="flex items-center gap-3">
                {w.last_grade ? (
                  <GradeBadge grade={w.last_grade} size="sm" />
                ) : (
                  <span className="h-8 w-8 shrink-0 rounded-lg border border-dashed border-[var(--lp-border)]" />
                )}
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  disabled={!w.last_scan_id}
                  onClick={() => w.last_scan_id && onOpen(w.last_scan_id)}
                >
                  <span className="block truncate text-sm text-[var(--lp-text)]">
                    {w.domain}
                  </span>
                  <span className="block text-2xs text-[var(--lp-subtle)]">
                    {!w.enabled ? (
                      "Paused"
                    ) : w.last_error ? (
                      <span className="text-[#ff8fb3]" title={w.last_error}>
                        Last check failed
                      </span>
                    ) : (
                      `Next check ${ago(w.next_run_at, true)}`
                    )}
                  </span>
                </button>
                <span title={w.enabled ? "Pause" : "Resume"}>
                  <Toggle
                    label=""
                    aria-label={
                      w.enabled
                        ? `Pause watching ${w.domain}`
                        : `Resume watching ${w.domain}`
                    }
                    checked={w.enabled}
                    disabled={busy}
                    onChange={(e) =>
                      onUpdate({ ...w, enabled: e.target.checked })
                    }
                  />
                </span>
              </div>
              <div className="flex items-center gap-2 pl-11">
                <select
                  className="h-7 min-w-0 flex-1 px-2 text-xs"
                  aria-label={`How often to check ${w.domain}`}
                  value={w.interval_hours}
                  disabled={busy}
                  onChange={(e) =>
                    onUpdate({
                      ...w,
                      interval_hours: Number(
                        e.target.value,
                      ) as SecurityWatch["interval_hours"],
                    })
                  }
                >
                  {intervals.map((h) => (
                    <option key={h} value={h}>
                      {intervalLabel[h]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rounded p-1 text-[var(--lp-subtle)] hover:text-[#ff8fb3]"
                  aria-label={`Stop watching ${w.domain}`}
                  title="Stop watching"
                  disabled={busy}
                  onClick={() => onRemove(w.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-[var(--lp-border)] px-4 py-4 text-xs leading-relaxed text-[var(--lp-subtle)]">
          {emptyText ??
            "Watch a domain to check it again on a schedule. You'll get an email, and an alert on channels that subscribe to security checks, when its grade drops or a new high-severity issue appears."}
        </p>
      )}
    </Panel>
  );
}
