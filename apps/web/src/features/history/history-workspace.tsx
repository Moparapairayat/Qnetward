"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Download, History, RefreshCw, Search } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import { HistoryPoint, RecentHistoryTarget } from "@/lib/types";
import { cn, formatDateTime, formatMs } from "@/lib/utils";
import { LiveSignalChart, type SignalPoint } from "@/components/charts/live-signal-chart";
import { Field, PageHeader, Panel, RunStatus, StatStrip, Toggle } from "@/components/tools/probe-ui";

const historyQuerySchema = z.object({
  type: z.enum(["ping", "tcpping"]),
  host: z.string().trim().min(1, "Target is required"),
  port: z.coerce.number().min(1, "Port must be between 1 and 65535").max(65535, "Port must be between 1 and 65535").optional(),
  limit: z.coerce.number().min(1, "Limit must be at least 1").max(1000, "Limit cannot exceed 1000"),
}).superRefine((value, ctx) => {
  if (value.type === "tcpping" && (!value.port || value.port < 1 || value.port > 65535)) {
    ctx.addIssue({
      code: "custom",
      path: ["port"],
      message: "Port is required for TCP Ping history",
    });
  }
});

type HistoryQueryInput = z.input<typeof historyQuerySchema>;
type HistoryQueryValues = z.output<typeof historyQuerySchema>;
type HistorySelection = {
  type: "ping" | "tcpping";
  host: string;
  port?: number;
  limit: number;
};

function fieldErrorText(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) {
    return null;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

function buildHistoryQueryString(selection: HistorySelection) {
  const params = new URLSearchParams();
  params.set("type", selection.type);
  params.set("host", selection.host);
  params.set("limit", String(selection.limit));
  if (selection.type === "tcpping" && selection.port) {
    params.set("port", String(selection.port));
  }
  return params.toString();
}

function exportHistoryFileName(format: "json" | "csv", selection: HistorySelection) {
  const safeHost = selection.host.replace(/[:/\\\s]+/g, "_");
  if (selection.type === "tcpping" && selection.port) {
    return `${selection.type}_${safeHost}_${selection.port}.${format}`;
  }
  return `${selection.type}_${safeHost}.${format}`;
}

function extractDownloadFileName(response: Response, fallback: string) {
  const disposition = response.headers.get("Content-Disposition") || response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*?=(?:UTF-8''|\"?)([^\";]+)/i);
  if (!match || !match[1]) {
    return fallback;
  }
  return decodeURIComponent(match[1].replace(/^UTF-8''/i, "").replace(/\"/g, ""));
}

function computeHistorySummary(points: HistoryPoint[]) {
  const rtts = points.filter((point) => typeof point.rtt_ms === "number").map((point) => point.rtt_ms as number);
  const sorted = [...rtts].sort((a, b) => a - b);
  const errorPoints = points.filter((point) => Boolean(point.error)).length;
  return {
    totalPoints: points.length,
    successfulPoints: rtts.length,
    errorPoints,
    successRate: points.length ? (rtts.length / points.length) * 100 : null,
    averageRttMs: rtts.length ? rtts.reduce((sum, v) => sum + v, 0) / rtts.length : null,
    p95RttMs: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null,
    latestPoint: points.reduce<HistoryPoint | null>((latest, point) => (!latest || point.ts > latest.ts ? point : latest), null),
  };
}

function relativeTime(ts: number, now: number) {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

const LIMIT_OPTIONS = [50, 120, 500, 1000];
const AUTO_REFRESH_MS = 10_000;

function parseSelectionFromSearchParams(searchParams: URLSearchParams): HistorySelection | null {
  const type = searchParams.get("type");
  const host = searchParams.get("host");
  if ((type !== "ping" && type !== "tcpping") || !host) {
    return null;
  }

  const limitValue = Number(searchParams.get("limit") || "120");
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? Math.min(limitValue, 1000) : 120;
  const portValue = Number(searchParams.get("port") || "0");

  return {
    type,
    host,
    port: type === "tcpping" && Number.isFinite(portValue) && portValue > 0 ? portValue : undefined,
    limit,
  };
}

export function HistoryWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialLoadDoneRef = useRef(false);
  const historyRetryTimerRef = useRef<number | null>(null);
  const historyRetryCountRef = useRef(0);
  const activeSelectionKeyRef = useRef("");

  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [selection, setSelection] = useState<HistorySelection | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<"json" | "csv" | null>(null);

  const form = useForm<HistoryQueryInput, unknown, HistoryQueryValues>({
    resolver: zodResolver(historyQuerySchema),
    defaultValues: {
      type: "ping",
      host: "",
      port: 443,
      limit: 120,
    },
  });

  const mode = form.watch("type");

  const loadHistoryMutation = useMutation({
    mutationFn: (nextSelection: HistorySelection) =>
      apiRequest<HistoryPoint[]>(`/api/history?${buildHistoryQueryString(nextSelection)}`),
    onSuccess: (data, nextSelection) => {
      setRequestError(null);
      setPoints(data);
      setSelection(nextSelection);
      router.replace(`${pathname}?${buildHistoryQueryString(nextSelection)}`, { scroll: false });

      if (
        data.length === 0 &&
        activeSelectionKeyRef.current === buildHistoryQueryString(nextSelection) &&
        historyRetryCountRef.current < 4
      ) {
        historyRetryCountRef.current += 1;
        if (historyRetryTimerRef.current) {
          window.clearTimeout(historyRetryTimerRef.current);
        }
        historyRetryTimerRef.current = window.setTimeout(() => {
          loadHistoryMutation.mutate(nextSelection);
        }, 700);
        return;
      }

      if (historyRetryTimerRef.current) {
        window.clearTimeout(historyRetryTimerRef.current);
        historyRetryTimerRef.current = null;
      }
    },
    onError: (error: ApiError) => {
      setRequestError(error.message);
      setPoints([]);
      if (historyRetryTimerRef.current) {
        window.clearTimeout(historyRetryTimerRef.current);
        historyRetryTimerRef.current = null;
      }
    },
  });

  const loadHistory = useCallback(async (values: HistoryQueryValues) => {
    const nextSelection: HistorySelection = {
      type: values.type,
      host: values.host,
      port: values.type === "tcpping" ? values.port : undefined,
      limit: values.limit,
    };
    activeSelectionKeyRef.current = buildHistoryQueryString(nextSelection);
    historyRetryCountRef.current = 0;
    if (historyRetryTimerRef.current) {
      window.clearTimeout(historyRetryTimerRef.current);
      historyRetryTimerRef.current = null;
    }
    await loadHistoryMutation.mutateAsync(nextSelection);
  }, [loadHistoryMutation]);

  useEffect(() => {
    return () => {
      if (historyRetryTimerRef.current) {
        window.clearTimeout(historyRetryTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (initialLoadDoneRef.current) {
      return;
    }
    initialLoadDoneRef.current = true;

    const nextSelection = parseSelectionFromSearchParams(new URLSearchParams(searchParams.toString()));
    if (!nextSelection) {
      return;
    }

    form.reset({
      type: nextSelection.type,
      host: nextSelection.host,
      port: nextSelection.port ?? 443,
      limit: nextSelection.limit,
    });
    void loadHistory({
      type: nextSelection.type,
      host: nextSelection.host,
      port: nextSelection.port,
      limit: nextSelection.limit,
    });
  }, [form, loadHistory, searchParams]);

  const summary = useMemo(() => computeHistorySummary(points), [points]);

  const handleExport = useCallback(async (format: "json" | "csv") => {
    if (!selection) {
      return;
    }

    setExportingFormat(format);
    setRequestError(null);

    try {
      const response = await fetch("/api/export/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          type: selection.type,
          host: selection.host,
          port: selection.port,
          limit: selection.limit,
          format,
        }),
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") ?? "";
        let message = "Unable to export history";
        if (contentType.includes("application/json")) {
          const payload = await response.json();
          if (payload && typeof payload === "object" && "error" in payload) {
            message = String((payload as { error?: string }).error || message);
          }
        } else {
          const text = await response.text();
          if (text) {
            message = text;
          }
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const downloadURL = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadURL;
      anchor.download = extractDownloadFileName(response, exportHistoryFileName(format, selection));
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadURL);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Unable to export history");
    } finally {
      setExportingFormat(null);
    }
  }, [selection]);

  const [errorsOnly, setErrorsOnly] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const isLoading = loadHistoryMutation.isPending;
  const errors = form.formState.errors;

  const recentTargetsQuery = useQuery({
    queryKey: ["recent-history-targets"],
    queryFn: () => apiRequest<RecentHistoryTarget[]>("/api/history/recent-targets?limit=12"),
    retry: false,
    staleTime: 30_000,
  });
  const recentTargets = recentTargetsQuery.data ?? [];

  // Keep "x ago" labels fresh and, when asked, re-pull the selection so new runs show up without reloading.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);
  const mutateRef = useRef(loadHistoryMutation.mutate);
  useEffect(() => {
    mutateRef.current = loadHistoryMutation.mutate;
  });
  useEffect(() => {
    if (!autoRefresh || !selection) return;
    const id = window.setInterval(() => mutateRef.current(selection), AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, selection]);

  const pickRecent = (target: RecentHistoryTarget) => {
    const values: HistoryQueryValues = {
      type: target.protocol,
      host: target.target,
      port: target.protocol === "tcpping" ? target.port : undefined,
      limit: Number(form.getValues("limit")) || 120,
    };
    form.reset({ ...values, port: values.port ?? 443 });
    void loadHistory(values);
  };

  // Samples are spaced evenly rather than by wall clock: stored runs can be hours apart and would
  // otherwise collapse into slivers joined by long flat bridges. The tooltip still shows the real time.
  const signalPoints = useMemo<SignalPoint[]>(
    () =>
      [...points]
        .sort((a, b) => a.ts - b.ts)
        .map((point, index) => ({ t: index * 1000, v: point.error || typeof point.rtt_ms !== "number" ? null : point.rtt_ms, label: formatDateTime(point.ts) })),
    [points],
  );
  const tablePoints = useMemo(() => {
    const newestFirst = [...points].sort((a, b) => b.ts - a.ts);
    return errorsOnly ? newestFirst.filter((point) => point.error) : newestFirst;
  }, [errorsOnly, points]);

  const selectionLabel = selection ? (selection.type === "tcpping" ? `${selection.host}:${selection.port}` : selection.host) : null;
  const hasData = points.length > 0;
  const exportDisabled = !selection || !hasData || exportingFormat !== null || isLoading;
  const dash = (text: string) => (text === "-" ? "—" : text);

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="History"
        description="Stored ICMP and TCP ping results for a target, with the latency trend, failures, and raw samples to export."
        status={
          selection ? (
            <RunStatus
              tone={requestError ? "error" : autoRefresh ? "live" : "done"}
              label={requestError ? "Failed" : autoRefresh ? "Auto-refreshing" : `${points.length} samples`}
            />
          ) : null
        }
      />

      <form className="rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-4" onSubmit={form.handleSubmit((values) => void loadHistory(values))}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="lg:w-auto">
            <span className="mb-1.5 block text-[12px] text-[var(--lp-muted)]">Protocol</span>
            <div className="flex h-10 rounded-lg border border-[var(--lp-border-strong)] bg-white/[0.03] p-1" role="radiogroup" aria-label="Protocol">
              {(["ping", "tcpping"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => form.setValue("type", value, { shouldValidate: form.formState.isSubmitted })}
                  className={cn(
                    "rounded-md px-3 text-[13px] transition-colors",
                    mode === value ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]",
                  )}
                >
                  {value === "ping" ? "ICMP" : "TCP"}
                </button>
              ))}
            </div>
          </div>
          <Field label="Target" error={fieldErrorText(errors.host) ?? undefined} className="min-w-0 flex-1">
            <input id="history-host" className="h-10 w-full px-3" placeholder="example.com or 8.8.8.8" autoComplete="off" {...form.register("host")} />
          </Field>
          {mode === "tcpping" ? (
            <Field label="Port" error={fieldErrorText(errors.port) ?? undefined} className="lg:w-28">
              <input id="history-port" type="number" className="h-10 w-full px-3" placeholder="443" {...form.register("port", { valueAsNumber: true })} />
            </Field>
          ) : null}
          <Field label="Samples" error={fieldErrorText(errors.limit) ?? undefined} className="lg:w-32">
            <select id="history-limit" className="h-10 w-full px-2" {...form.register("limit", { valueAsNumber: true })}>
              {LIMIT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  Last {n}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="console-btn console-btn-primary h-10 px-5" disabled={isLoading}>
            <Search className="h-3.5 w-3.5" /> {isLoading ? "Loading" : "Load"}
          </button>
        </div>

        {recentTargets.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[12px] text-[var(--lp-subtle)]">Recent</span>
            {recentTargets.map((target) => {
              const label = target.protocol === "tcpping" ? `${target.target}:${target.port}` : target.target;
              const active =
                selection?.type === target.protocol && selection.host === target.target && (target.protocol !== "tcpping" || selection.port === target.port);
              return (
                <button
                  key={`${target.protocol}:${target.target}:${target.port ?? 0}`}
                  type="button"
                  onClick={() => pickRecent(target)}
                  title={`Last sample ${relativeTime(target.last_sample_at, now)}`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-colors",
                    active
                      ? "border-[rgba(255,61,127,0.45)] bg-[rgba(255,61,127,0.1)] text-[var(--lp-text)]"
                      : "border-[var(--lp-border)] text-[var(--lp-muted)] hover:border-[var(--lp-border-strong)] hover:text-[var(--lp-text)]",
                  )}
                >
                  <span className="text-[10px] text-[var(--lp-subtle)]">{target.protocol === "tcpping" ? "TCP" : "ICMP"}</span>
                  <span className="lp-mono">{label}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {requestError ? (
          <p className="mt-4 rounded-lg border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] px-3 py-2.5 text-[13px] text-[#ff8fb3]">{requestError}</p>
        ) : null}
      </form>

      <StatStrip
        items={[
          { label: "Samples", value: hasData ? String(summary.totalPoints) : "—" },
          {
            label: "Success rate",
            value: summary.successRate === null ? "—" : `${summary.successRate.toFixed(summary.successRate === 100 ? 0 : 1)}%`,
            tone: summary.successRate === null ? undefined : summary.successRate >= 99 ? "good" : summary.successRate >= 90 ? "warn" : "bad",
            better: "higher",
          },
          { label: "Failures", value: hasData ? String(summary.errorPoints) : "—", tone: summary.errorPoints ? "bad" : undefined, better: "lower" },
          { label: "Average", value: dash(formatMs(summary.averageRttMs)), better: "lower" },
          { label: "p95", value: dash(formatMs(summary.p95RttMs)), better: "lower" },
          { label: "Last sample", value: summary.latestPoint ? relativeTime(summary.latestPoint.ts, now) : "—" },
        ]}
      />

      <Panel
        title={selectionLabel ? `Latency · ${selectionLabel}` : "Latency"}
        aside={
          selection ? (
            <div className="flex items-center gap-3">
              <Toggle label="Auto-refresh" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
              <button
                type="button"
                className="console-btn console-btn-secondary h-8 w-8 px-0"
                aria-label="Refresh now"
                disabled={isLoading}
                onClick={() => loadHistoryMutation.mutate(selection)}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
              </button>
            </div>
          ) : null
        }
      >
        {selection || isLoading ? (
          <LiveSignalChart points={signalPoints} live={false} emptyText={isLoading ? "Loading samples…" : "No stored samples for this target yet."} />
        ) : (
          <div className="flex h-[220px] flex-col items-center justify-center rounded-lg border border-dashed border-[var(--lp-border)] text-center">
            <History className="h-5 w-5 text-[var(--lp-subtle)]" />
            <p className="mt-3 text-[13px] text-[var(--lp-muted)]">Pick a target to see its history</p>
            <p className="mt-1 text-[12px] text-[var(--lp-subtle)]">Every ping and TCP ping you run is stored and shows up here.</p>
          </div>
        )}
        {hasData ? <p className="mt-2 text-[12px] text-[var(--lp-subtle)]">Failures sit on the floor in red · hover to read a sample</p> : null}
      </Panel>

      <Panel
        title="Samples"
        bodyClassName="p-0"
        aside={
          selection ? (
            <div className="flex items-center gap-3">
              <Toggle label="Failures only" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
              <div className="flex gap-1.5">
                <button type="button" className="console-btn console-btn-secondary h-8" disabled={exportDisabled} onClick={() => void handleExport("csv")}>
                  <Download className="h-3.5 w-3.5" /> {exportingFormat === "csv" ? "Exporting" : "CSV"}
                </button>
                <button type="button" className="console-btn console-btn-secondary h-8" disabled={exportDisabled} onClick={() => void handleExport("json")}>
                  <Download className="h-3.5 w-3.5" /> {exportingFormat === "json" ? "Exporting" : "JSON"}
                </button>
              </div>
            </div>
          ) : null
        }
      >
        {tablePoints.length ? (
          <div className="max-h-[460px] overflow-y-auto border-t border-[var(--lp-border)]">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-[#1b1b1f]">
                <tr className="border-b border-[var(--lp-border)] text-left text-[12px] text-[var(--lp-subtle)]">
                  <th className="px-4 py-2 font-medium">Time</th>
                  <th className="px-4 py-2 font-medium">Seq</th>
                  <th className="px-4 py-2 text-right font-medium">Latency</th>
                  <th className="px-4 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {tablePoints.map((point) => (
                  <tr key={`${point.ts}-${point.seq ?? 0}`} className="border-b border-[var(--lp-border)] last:border-0">
                    <td className="px-4 py-2 text-[var(--lp-muted)]">{formatDateTime(point.ts)}</td>
                    <td className="lp-mono px-4 py-2 text-[var(--lp-subtle)]">{point.seq ?? "—"}</td>
                    <td className="lp-mono px-4 py-2 text-right">{typeof point.rtt_ms === "number" ? formatMs(point.rtt_ms) : "—"}</td>
                    <td className="px-4 py-2">
                      {point.error ? (
                        <span className="text-[#ff8fb3]" title={point.error}>
                          {point.error.length > 48 ? `${point.error.slice(0, 48)}…` : point.error}
                        </span>
                      ) : (
                        <span className="text-[#86efac]">Reply</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 pb-4 text-[13px] text-[var(--lp-subtle)]">
            {hasData ? "No failures in these samples." : selection ? "No stored samples for this target yet." : "Samples appear here once you load a target."}
          </p>
        )}
      </Panel>
    </div>
  );
}
