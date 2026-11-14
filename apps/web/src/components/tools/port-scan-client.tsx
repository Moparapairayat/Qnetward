"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Play, SlidersHorizontal, Square } from "@/components/icons";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ProbeReport } from "@/lib/types";
import { ProbeRunState, useRealtimeProbe } from "@/hooks/use-realtime-probe";
import { cn, formatMs } from "@/lib/utils";
import { Field, PageHeader, Panel, RunStatus, StatStrip, Toggle, type RunTone } from "@/components/tools/probe-ui";

const schema = z.object({
  host: z.string().min(1, "Target is required"),
  ports: z.string().min(1, "Ports are required"),
  timeout_ms: z.coerce.number().min(100).max(60000),
  concurrency: z.coerce.number().min(1).max(256),
});

type FormValues = z.infer<typeof schema>;
type FormInput = z.input<typeof schema>;

const scanPresets = [
  { id: "top-ports", label: "Top 20", ports: "20-25,53,80,110,111,135,139,143,443,445,993,995,1433,3306,3389,5432,5900,6379,8080", concurrency: 48 },
  { id: "web", label: "Web", ports: "80,81,443,444,3000,4000,5000,7001,8000,8080,8081,8443,9000", concurrency: 32 },
  { id: "mail", label: "Mail", ports: "25,110,143,465,587,993,995,4190", concurrency: 24 },
  { id: "database", label: "Database", ports: "1433,1521,27017,3306,50000,5432,6379,9042", concurrency: 16 },
  { id: "infra", label: "Infra", ports: "22,53,67,68,80,123,161,389,443,636,2049,2379,2380,6443,8080", concurrency: 24 },
];

const serviceLabels: Record<number, string> = {
  20: "FTP Data",
  21: "FTP",
  22: "SSH",
  23: "Telnet",
  25: "SMTP",
  53: "DNS",
  67: "DHCP",
  68: "DHCP",
  80: "HTTP",
  81: "HTTP Alt",
  110: "POP3",
  111: "RPCbind",
  123: "NTP",
  135: "MSRPC",
  139: "NetBIOS",
  143: "IMAP",
  161: "SNMP",
  389: "LDAP",
  443: "HTTPS",
  444: "HTTPS Alt",
  445: "SMB",
  465: "SMTPS",
  587: "Submission",
  636: "LDAPS",
  993: "IMAPS",
  995: "POP3S",
  1433: "MSSQL",
  1521: "Oracle",
  2049: "NFS",
  2379: "etcd",
  2380: "etcd Peer",
  3000: "Web App",
  3306: "MySQL",
  3389: "RDP",
  4000: "Web App",
  4190: "Sieve",
  5000: "Web API",
  5432: "Postgres",
  5900: "VNC",
  6379: "Redis",
  6443: "Kubernetes",
  7001: "App Server",
  8000: "HTTP Alt",
  8080: "HTTP Alt",
  8081: "HTTP Alt",
  8443: "HTTPS Alt",
  9000: "Admin API",
  9042: "Cassandra",
  27017: "MongoDB",
  50000: "DB2",
};

type PortScanSortKey = "port" | "state" | "rtt";

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

export function PortScanClient() {
  const [openOnly, setOpenOnly] = useState(false);
  const [sortKey, setSortKey] = useState<PortScanSortKey>("port");
  const form = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      host: "",
      ports: "22,80,443,8080",
      timeout_ms: 2000,
      concurrency: 64,
    },
  });

  const { formError, report, run, runState, stop, isBusy } = useRealtimeProbe<FormValues>({
    type: "portscan",
    httpPath: "/api/portscan",
    buildInitialReport: (values): ProbeReport => ({
      protocol: "tcp-portscan",
      target: values.host,
      results: [],
      summary: {},
    }),
  });

  const visibleResults = useMemo(() => {
    const base = [...(report?.results ?? [])];
    const filtered = openOnly ? base.filter((result) => result.state === "open") : base;

    filtered.sort((left, right) => {
      if (sortKey === "state") {
        const rank = (state?: string) => {
          switch (state) {
            case "open":
              return 0;
            case "timeout":
              return 1;
            case "closed":
              return 2;
            default:
              return 3;
          }
        };
        const stateDiff = rank(left.state) - rank(right.state);
        if (stateDiff !== 0) {
          return stateDiff;
        }
        return (left.port ?? 0) - (right.port ?? 0);
      }

      if (sortKey === "rtt") {
        const leftRTT = typeof left.rtt_ms === "number" ? left.rtt_ms : Number.MAX_SAFE_INTEGER;
        const rightRTT = typeof right.rtt_ms === "number" ? right.rtt_ms : Number.MAX_SAFE_INTEGER;
        if (leftRTT !== rightRTT) {
          return leftRTT - rightRTT;
        }
      }

      return (left.port ?? 0) - (right.port ?? 0);
    });

    return filtered;
  }, [openOnly, report?.results, sortKey]);
  const openPortCount = useMemo(() => (report?.results ?? []).filter((result) => result.state === "open").length, [report?.results]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const searchParams = useSearchParams();
  useEffect(() => {
    const target = searchParams.get("target")?.trim();
    if (target) form.setValue("host", target);
  }, [form, searchParams]);

  const results = useMemo(() => report?.results ?? [], [report?.results]);
  const counts = useMemo(() => {
    const closed = results.filter((r) => r.state === "closed").length;
    const filtered = results.filter((r) => r.state !== "open" && r.state !== "closed").length;
    const openRtts = results.filter((r) => r.state === "open" && typeof r.rtt_ms === "number").map((r) => r.rtt_ms as number);
    return { closed, filtered, fastest: openRtts.length ? Math.min(...openRtts) : null };
  }, [results]);
  const summary = report?.summary;
  const tone: RunTone = runState === "error" ? "error" : isBusy ? "live" : results.length ? "done" : "idle";
  const errors = form.formState.errors;
  const portMap = useMemo(() => [...results].sort((a, b) => (a.port ?? 0) - (b.port ?? 0)), [results]);

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="Port scan"
        description="Check which TCP ports accept connections on a host, with handshake time for each open port."
        status={<RunStatus tone={tone} label={runStateLabel(runState)} />}
      />

      <form className="rounded-xl border border-[var(--lp-border)] bg-[#0a0a0a] p-4" onSubmit={form.handleSubmit((values) => void run(values))}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <Field label="Target" error={errors.host?.message} className="min-w-0 flex-1">
            <input id="scan-target" className="h-10 w-full px-3" placeholder="example.com or 203.0.113.10" autoComplete="off" {...form.register("host")} />
          </Field>
          <div className="flex gap-2">
            <button type="submit" className="console-btn console-btn-primary h-10 flex-1 px-5 md:flex-none" disabled={isBusy}>
              <Play className="h-3.5 w-3.5" /> {isBusy ? runStateLabel(runState) : "Scan"}
            </button>
            <button type="button" className="console-btn console-btn-secondary h-10 px-4" disabled={!isBusy} onClick={stop}>
              <Square className="h-3 w-3" /> Stop
            </button>
          </div>
        </div>

        <div className="mt-3">
          <Field label="Ports" hint="Comma-separated ports and ranges, up to 4,096" error={errors.ports?.message}>
            <input id="scan-ports" className="lp-mono h-10 w-full px-3 text-sm" placeholder="22,80,443,8000-8100" {...form.register("ports")} />
          </Field>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-[var(--lp-subtle)]">Presets</span>
            {scanPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  form.setValue("ports", preset.ports, { shouldValidate: true });
                  form.setValue("concurrency", preset.concurrency);
                }}
                className="rounded-md border border-[var(--lp-border)] px-2.5 py-1 text-xs text-[var(--lp-muted)] transition-colors hover:border-[var(--lp-border-strong)] hover:text-[var(--lp-text)]"
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              className="ml-auto inline-flex -my-1.5 py-1.5 items-center gap-1 text-sm text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" /> Options
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showAdvanced && "rotate-180")} />
            </button>
          </div>
        </div>

        {showAdvanced ? (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--lp-border)] pt-4 md:max-w-md">
            <Field label="Timeout per port (ms)" error={errors.timeout_ms?.message}>
              <input type="number" className="h-9 w-full px-3" {...form.register("timeout_ms", { valueAsNumber: true })} />
            </Field>
            <Field label="Parallel connections" hint="1 to 256" error={errors.concurrency?.message}>
              <input type="number" className="h-9 w-full px-3" {...form.register("concurrency", { valueAsNumber: true })} />
            </Field>
          </div>
        ) : null}

        {formError ? (
          <p className="mt-4 rounded-lg border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] px-3 py-2.5 text-sm text-[#ff8fb3]">
            {formError}
          </p>
        ) : null}
        <p className="mt-3 text-xs text-[var(--lp-subtle)]">Only scan hosts you own or have permission to test.</p>
      </form>

      <StatStrip
        items={[
          { label: "Scanned", value: results.length ? String(summary?.scanned ?? results.length) : "—" },
          { label: "Open", value: results.length ? String(summary?.open ?? openPortCount) : "—", tone: openPortCount ? "good" : undefined },
          { label: "Closed", value: results.length ? String(summary?.closed ?? counts.closed) : "—" },
          { label: "Filtered", value: results.length ? String(counts.filtered) : "—", tone: counts.filtered ? "warn" : undefined },
          { label: "Fastest open", value: counts.fastest !== null ? formatMs(counts.fastest) : "—" },
          { label: "Duration", value: summary?.duration || "—" },
        ]}
      />

      {portMap.length ? (
        <Panel
          title="Port map"
          aside={
            <span className="flex gap-3 text-xs text-[var(--lp-subtle)]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-[#4ade80]" /> open
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-[#fbbf24]" /> filtered
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm bg-white/15" /> closed
              </span>
            </span>
          }
        >
          <div className="flex flex-wrap gap-1">
            {portMap.map((r) => (
              <span
                key={r.port}
                title={`${r.port} · ${r.state ?? "unknown"}${serviceLabels[r.port ?? 0] ? ` · ${serviceLabels[r.port ?? 0]}` : ""}`}
                className="lp-mono grid h-7 min-w-[44px] place-items-center rounded px-1 text-2xs"
                style={
                  r.state === "open"
                    ? { background: "rgba(74,222,128,0.15)", color: "#86efac" }
                    : r.state === "closed"
                      ? { background: "rgba(255,255,255,0.05)", color: "var(--lp-subtle)" }
                      : { background: "rgba(251,191,36,0.12)", color: "#fcd34d" }
                }
              >
                {r.port}
              </span>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Results"
        bodyClassName="p-0"
        aside={
          results.length ? (
            <div className="flex items-center gap-3">
              <Toggle label="Open only" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
              <select
                aria-label="Sort results"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as PortScanSortKey)}
                className="h-8 px-2 text-sm"
              >
                <option value="port">Sort by port</option>
                <option value="state">Sort by state</option>
                <option value="rtt">Sort by time</option>
              </select>
            </div>
          ) : null
        }
      >
        {visibleResults.length ? (
          <div className="max-h-[420px] overflow-y-auto border-t border-[var(--lp-border)]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#0a0a0a]">
                <tr className="border-b border-[var(--lp-border)] text-left text-xs text-[var(--lp-subtle)]">
                  <th className="px-4 py-2 font-medium">Port</th>
                  <th className="px-4 py-2 font-medium">Service</th>
                  <th className="px-4 py-2 font-medium">State</th>
                  <th className="px-4 py-2 text-right font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {visibleResults.map((r) => (
                  <tr key={`${r.port}-${r.state}`} className="border-b border-[var(--lp-border)] last:border-0">
                    <td className="lp-mono px-4 py-2">{r.port}/tcp</td>
                    <td className="px-4 py-2 text-[var(--lp-muted)]">{serviceLabels[r.port ?? 0] ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span
                        className="rounded-md border px-2 py-0.5 text-xs"
                        style={
                          r.state === "open"
                            ? { borderColor: "rgba(74,222,128,0.3)", color: "#86efac", background: "rgba(74,222,128,0.08)" }
                            : r.state === "closed"
                              ? { borderColor: "var(--lp-border)", color: "var(--lp-muted)" }
                              : { borderColor: "rgba(251,191,36,0.3)", color: "#fcd34d", background: "rgba(251,191,36,0.08)" }
                        }
                      >
                        {r.state === "timeout" ? "filtered" : (r.state ?? "unknown")}
                      </span>
                    </td>
                    <td className="lp-mono px-4 py-2 text-right">{typeof r.rtt_ms === "number" ? formatMs(r.rtt_ms) : r.rtt || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 pb-4 text-sm text-[var(--lp-subtle)]">
            {results.length ? "No open ports in this scan." : "Pick ports or a preset, then scan. Results stream in as each port answers."}
          </p>
        )}
      </Panel>
    </div>
  );
}
