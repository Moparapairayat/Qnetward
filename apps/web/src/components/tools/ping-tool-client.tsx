"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Play, SlidersHorizontal, Square } from "@/components/icons";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ProbeReport } from "@/lib/types";
import { ProbeRunState, useRealtimeProbe } from "@/hooks/use-realtime-probe";
import { cn, formatMs } from "@/lib/utils";
import { LivePill, LiveSignalChart } from "@/components/charts/live-signal-chart";
import { DefinitionList, Field, PageHeader, Panel, RunStatus, StatStrip, Toggle, type RunTone } from "@/components/tools/probe-ui";

const pingSchema = z
  .object({
    host: z.string().min(1, "Target is required"),
    count: z.coerce.number(),
    interval_ms: z.coerce.number().min(100).max(60000),
    timeout_ms: z.coerce.number().min(100).max(60000),
    size: z.coerce.number().min(8).max(1500),
    ipv6: z.boolean(),
    continuous: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (!Number.isFinite(data.count)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "Count is required" });
      return;
    }
    if (data.continuous) {
      if (data.count < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "Count cannot be negative" });
      }
      return;
    }
    if (data.count < 1 || data.count > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "Count must be 1-100" });
    }
  });

const tcpSchema = z
  .object({
    host: z.string().min(1, "Target is required"),
    port: z.coerce.number().min(1).max(65535),
    count: z.coerce.number(),
    interval_ms: z.coerce.number().min(100).max(60000),
    timeout_ms: z.coerce.number().min(100).max(60000),
    continuous: z.boolean(),
  })
  .superRefine((data, ctx) => {
    if (!Number.isFinite(data.count)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "Count is required" });
      return;
    }
    if (data.continuous) {
      if (data.count < 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "Count cannot be negative" });
      }
      return;
    }
    if (data.count < 1 || data.count > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "Count must be 1-100" });
    }
  });

type PingValues = z.infer<typeof pingSchema>;
type TCPValues = z.infer<typeof tcpSchema>;
type PingInput = z.input<typeof pingSchema>;
type TCPInput = z.input<typeof tcpSchema>;

function runStateLabel(state: ProbeRunState) {
  switch (state) {
    case "connecting":
      return "Connecting";
    case "running":
      return "Running";
    case "stopping":
      return "Stopping";
    case "done":
      return "Done";
    case "stopped":
      return "Stopped";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

function summaryValue(value?: string | number | null, suffix = "") {
  if (typeof value === "number") {
    return `${value}${suffix}`;
  }
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return "-";
}

function parseLatencyMs(value?: string | number | null) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const match = value.match(/-?\d+(\.\d+)?/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function PingToolClient({ mode }: { mode: "ping" | "tcpping" }) {
  const isPing = mode === "ping";
  const [activeContinuous, setActiveContinuous] = useState(false);
  const schema = useMemo(() => (isPing ? pingSchema : tcpSchema), [isPing]);
  const form = useForm<PingInput | TCPInput, unknown, PingValues | TCPValues>({
    resolver: zodResolver(schema),
    defaultValues: isPing
      ? { host: "", count: 5, interval_ms: 1000, timeout_ms: 2000, size: 32, ipv6: false, continuous: false }
      : { host: "", port: 443, count: 5, interval_ms: 1000, timeout_ms: 2000, continuous: false },
  });

  const { formError, report, run, runState, stop, isBusy } = useRealtimeProbe<PingValues | TCPValues>({
    type: isPing ? "ping" : "tcpping",
    httpPath: isPing ? "/api/ping" : "/api/tcpping",
    buildInitialReport: (values): ProbeReport => ({
      protocol: isPing ? "icmp" : "tcp",
      target: values.host,
      port: "port" in values && typeof values.port === "number" ? values.port : undefined,
      results: [],
      summary: {},
    }),
  });

  const [showAdvanced, setShowAdvanced] = useState(false);
  const searchParams = useSearchParams();

  // Prefill from the overview's quick probe (?target=host or host:port).
  useEffect(() => {
    const target = searchParams.get("target")?.trim();
    if (!target) return;
    const [host, port] = !isPing && /:\d+$/.test(target) ? [target.replace(/:\d+$/, ""), Number(target.split(":").pop())] : [target, undefined];
    form.setValue("host", host);
    if (!isPing && port) form.setValue("port" as const, port);
  }, [form, isPing, searchParams]);

  const summary = report?.summary;
  const continuous = useWatch({ control: form.control, name: "continuous" }) === true;
  const results = useMemo(() => report?.results ?? [], [report]);
  const intervalMs = Number(useWatch({ control: form.control, name: "interval_ms" })) || 1000;
  const countValue = Number(useWatch({ control: form.control, name: "count" })) || 5;
  // Streamed results carry their arrival time; HTTP fallback results are spaced by the interval.
  const signalPoints = useMemo(() => {
    const base = results.find((r) => typeof r.ts === "number")?.ts ?? 0;
    return results.slice(-240).map((r, i) => ({
      t: typeof r.ts === "number" ? r.ts : base + i * intervalMs,
      v: r.error ? null : parseLatencyMs(r.rtt_ms ?? r.rtt),
      label: `seq ${r.seq ?? i + 1}`,
    }));
  }, [results, intervalMs]);
  const signalWindow = activeContinuous ? 60_000 : Math.min(60_000, Math.max(10_000, countValue * intervalMs + 2_000));
  const lastSampleAt = results.at(-1)?.ts ?? null;
  const live = useMemo(() => {
    const ok = results.map((r) => (r.error ? null : parseLatencyMs(r.rtt_ms ?? r.rtt))).filter((v): v is number => typeof v === "number");
    const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
    return {
      sent: results.length,
      recv: ok.length,
      loss: results.length ? ((results.length - ok.length) / results.length) * 100 : null,
      avg,
      min: ok.length ? Math.min(...ok) : null,
      max: ok.length ? Math.max(...ok) : null,
    };
  }, [results]);

  const sent = summary?.sent ?? live.sent;
  const recv = summary?.recv ?? live.recv;
  const loss = typeof summary?.loss === "number" ? summary.loss : live.loss;
  const tone: RunTone = runState === "error" ? "error" : isBusy ? "live" : report && results.length ? "done" : "idle";
  const errors = form.formState.errors as Record<string, { message?: string } | undefined>;

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title={isPing ? "ICMP ping" : "TCP ping"}
        description={
          isPing
            ? "Send ICMP echo requests and watch round-trip time, loss, and jitter as each reply arrives."
            : "Open TCP connections to a port and measure handshake time, the closest thing to what an application sees."
        }
        status={<RunStatus tone={tone} label={runStateLabel(runState)} />}
      />

      <form
        className="rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-4"
        onSubmit={form.handleSubmit((values) => {
          setActiveContinuous(values.continuous === true);
          void run(values);
        })}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <Field label="Target" error={errors.host?.message} className="min-w-0 flex-1">
            <input
              id="probe-target"
              className="h-10 w-full px-3"
              placeholder={isPing ? "example.com or 1.1.1.1" : "api.example.com"}
              autoComplete="off"
              {...form.register("host")}
            />
          </Field>
          {!isPing ? (
            <Field label="Port" error={errors.port?.message} className="md:w-28">
              <input id="probe-port" type="number" className="h-10 w-full px-3" {...form.register("port" as const, { valueAsNumber: true })} />
            </Field>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" className="console-btn console-btn-primary h-10 flex-1 px-5 md:flex-none" disabled={isBusy}>
              <Play className="h-3.5 w-3.5" /> {isBusy ? runStateLabel(runState) : "Run"}
            </button>
            <button type="button" className="console-btn console-btn-secondary h-10 px-4" disabled={!isBusy} onClick={stop}>
              <Square className="h-3 w-3" /> Stop
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-[var(--lp-border)] pt-4">
          <Toggle label="Continuous" description="Keep probing until you press Stop" {...form.register("continuous")} />
          {isPing ? <Toggle label="Force IPv6" {...form.register("ipv6")} /> : null}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="ml-auto inline-flex items-center gap-1 text-[13px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Options
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAdvanced && "rotate-180")} />
          </button>
        </div>

        {showAdvanced ? (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Count" hint={continuous ? "Ignored in continuous mode" : "1 to 100"} error={errors.count?.message}>
              <input
                type="number"
                className={cn("h-9 w-full px-3", continuous && "opacity-50")}
                readOnly={continuous}
                aria-disabled={continuous}
                {...form.register("count", { valueAsNumber: true })}
              />
            </Field>
            <Field label="Interval (ms)" error={errors.interval_ms?.message}>
              <input type="number" className="h-9 w-full px-3" {...form.register("interval_ms", { valueAsNumber: true })} />
            </Field>
            <Field label="Timeout (ms)" error={errors.timeout_ms?.message}>
              <input type="number" className="h-9 w-full px-3" {...form.register("timeout_ms", { valueAsNumber: true })} />
            </Field>
            {isPing ? (
              <Field label="Payload (bytes)" error={errors.size?.message}>
                <input type="number" className="h-9 w-full px-3" {...form.register("size", { valueAsNumber: true })} />
              </Field>
            ) : null}
          </div>
        ) : null}

        {formError ? (
          <p className="mt-4 rounded-lg border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] px-3 py-2.5 text-[13px] text-[#ff8fb3]">
            {formError}
          </p>
        ) : null}
        {isPing ? (
          <p className="mt-3 text-[12px] text-[var(--lp-subtle)]">
            ICMP can need elevated privileges on the server. If it fails, TCP ping usually works.
          </p>
        ) : null}
      </form>

      <StatStrip
        items={[
          { label: "Sent / received", value: sent ? `${sent} / ${recv}` : "—" },
          {
            label: "Packet loss",
            value: typeof loss === "number" ? `${loss.toFixed(loss < 10 ? 1 : 0)}%` : "—",
            tone: typeof loss !== "number" ? undefined : loss === 0 ? "good" : loss < 5 ? "warn" : "bad",
          },
          { label: "Average", better: "lower", value: summary?.avg || (live.avg !== null ? formatMs(live.avg) : "—") },
          { label: "Fastest", better: "lower", value: summary?.min || (live.min !== null ? formatMs(live.min) : "—") },
          { label: "Slowest", better: "lower", value: summary?.max || (live.max !== null ? formatMs(live.max) : "—") },
          { label: "Jitter", better: "lower", value: summaryValue(summary?.jitter) === "-" ? "—" : summaryValue(summary?.jitter) },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Panel
          title="Latency"
          aside={<LivePill live={isBusy && results.length > 0} updatedAt={lastSampleAt} />}
        >
          <LiveSignalChart
            points={signalPoints}
            live={isBusy}
            windowMs={signalWindow}
            emptyText="Run a probe and each reply streams in here as it arrives."
          />
          {results.length ? <p className="mt-2 text-[12px] text-[var(--lp-subtle)]">{currentRunLabel(activeContinuous, results.length)} · hover to pause</p> : null}
        </Panel>
        <Panel title="Run details">
          <DefinitionList
            items={[
              { label: "Target", value: report?.target || "—" },
              { label: "Address", value: report?.addr || results.at(-1)?.addr || "—" },
              { label: "Protocol", value: isPing ? "ICMP" : `TCP ${report?.port ?? ""}`.trim() },
              { label: "Median", value: summaryValue(summary?.median) === "-" ? "—" : summaryValue(summary?.median) },
              { label: "Std dev", value: summaryValue(summary?.stddev) === "-" ? "—" : summaryValue(summary?.stddev) },
              { label: "Loss streak", value: typeof summary?.loss_streak === "number" ? String(summary.loss_streak) : "—" },
              { label: "Duration", value: summaryValue(summary?.duration) === "-" ? "—" : summaryValue(summary?.duration) },
            ]}
          />
        </Panel>
      </div>

      <Panel
        title="Replies"
        aside={<span className="text-[12px] text-[var(--lp-subtle)]">{results.length ? `${results.length} total, newest first` : ""}</span>}
        bodyClassName="p-0"
      >
        {results.length ? (
          <div className="max-h-[360px] overflow-y-auto border-t border-[var(--lp-border)]">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-[#1b1b1f]">
                <tr className="border-b border-[var(--lp-border)] text-left text-[12px] text-[var(--lp-subtle)]">
                  <th className="px-4 py-2 font-medium">Seq</th>
                  <th className="px-4 py-2 font-medium">Address</th>
                  <th className="px-4 py-2 text-right font-medium">Time</th>
                  <th className="px-4 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {[...results].reverse().map((r, i) => (
                  <tr key={`${r.seq ?? i}-${i}`} className="border-b border-[var(--lp-border)] last:border-0">
                    <td className="lp-mono px-4 py-2 text-[var(--lp-subtle)]">{r.seq ?? "—"}</td>
                    <td className="lp-mono px-4 py-2 text-[var(--lp-muted)]">{r.addr || report?.addr || "—"}</td>
                    <td className="lp-mono px-4 py-2 text-right">
                      {r.error ? "—" : r.rtt || (typeof r.rtt_ms === "number" ? formatMs(r.rtt_ms) : "—")}
                    </td>
                    <td className="px-4 py-2">
                      {r.error ? <span className="text-[#fcd34d]">{r.error}</span> : <span className="text-[#86efac]">Reply</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 pb-4 text-[13px] text-[var(--lp-subtle)]">No replies yet.</p>
        )}
      </Panel>
    </div>
  );
}

function currentRunLabel(continuous: boolean, count: number) {
  if (!count) return "";
  return continuous ? `continuous · ${count} replies` : `${count} replies`;
}
