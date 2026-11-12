"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, Server } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { Host, HostListResponse, HostSeriesResponse } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { DefinitionList, PageHeader, Panel, RunStatus, StatStrip } from "@/components/tools/probe-ui";

const WARN = 85;
const CRIT = 95;

export function formatBytes(n?: number | null) {
  if (n == null || !Number.isFinite(n)) return "–";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function formatRate(bps?: number | null) {
  return bps == null ? "–" : `${formatBytes(bps)}/s`;
}

// Short form for chart axes, such as 29K or 1.2M bytes per second.
function formatRateShort(bps: number) {
  if (bps >= 1024 ** 3) return `${(bps / 1024 ** 3).toFixed(1)}G`;
  if (bps >= 1024 ** 2) return `${(bps / 1024 ** 2).toFixed(1)}M`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)}K`;
  return `${bps.toFixed(0)}B`;
}

function formatUptime(secs?: number) {
  if (!secs) return "–";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

const pct = (used?: number, total?: number) => (total ? (used! / total) * 100 : null);

function fullestDisk(h: Host) {
  const disks = h.latest?.disks ?? [];
  let best: (typeof disks)[number] | null = null;
  for (const d of disks) if (d.total && (!best || d.used / d.total > best.used / best.total)) best = d;
  return best;
}

type Health = "healthy" | "warning" | "critical" | "offline" | "waiting";

function hostHealth(h: Host): Health {
  if (!h.online) return "offline";
  if (!h.latest) return "waiting";
  const disk = fullestDisk(h);
  const values = [h.latest.cpu, pct(h.latest.mem_used, h.latest.mem_total) ?? 0, disk ? (disk.used / disk.total) * 100 : 0];
  if (values.some((v) => v >= CRIT)) return "critical";
  if (values.some((v) => v >= WARN)) return "warning";
  return "healthy";
}

const healthMeta: Record<Health, { label: string; className: string }> = {
  healthy: { label: "Healthy", className: "text-[#86efac]" },
  warning: { label: "Warning", className: "text-[#fcd34d]" },
  critical: { label: "Critical", className: "text-[#ff8fb3]" },
  offline: { label: "Offline", className: "text-[var(--lp-subtle)]" },
  waiting: { label: "No metrics yet", className: "text-[var(--lp-subtle)]" },
};

function Meter({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[var(--lp-subtle)]">–</span>;
  const color = value >= CRIT ? "bg-[#ff3d7f]" : value >= WARN ? "bg-[#fbbf24]" : "bg-[#4ade80]";
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.08]">
        <span className={cn("block h-full rounded-full", color)} style={{ width: `${Math.min(100, Math.max(2, value))}%` }} />
      </span>
      <span className="lp-mono w-10 text-right text-[12px]">{value.toFixed(0)}%</span>
    </span>
  );
}

type HostInfo = { os?: string; platform?: string; platform_version?: string; kernel?: string; arch?: string; cpu_model?: string; cores?: number; mem_total?: number; boot_time?: number; virtualization?: string };

function osLabel(h: Host) {
  const info = (h.info ?? {}) as HostInfo;
  if (info.platform) return `${info.platform.replace(/^\w/, (c) => c.toUpperCase())} ${info.platform_version ?? ""}`.trim();
  return h.platform || "–";
}

const ranges = ["1h", "6h", "24h", "7d", "14d"] as const;
type Range = (typeof ranges)[number];

const tooltipStyle = { background: "#16161a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, color: "#e8e8ec", fontSize: 12 };

function Chart({
  title,
  data,
  series,
  format,
  axisFormat,
  max,
}: {
  title: string;
  data: Record<string, number | string>[];
  series: { key: string; label: string; color: string }[];
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  max?: number;
}) {
  const tick = (ts: number) => {
    const d = new Date(ts);
    return data.length && Number(data[data.length - 1].ts) - Number(data[0].ts) > 36 * 3600_000
      ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };
  const Kind = series.length > 1 ? LineChart : AreaChart;
  return (
    <div className="rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12px] text-[var(--lp-muted)]">{title}</span>
        {series.length > 1 ? (
          <span className="flex gap-3 text-[11px] text-[var(--lp-subtle)]">
            {series.map((s) => (
              <span key={s.key} className="flex items-center gap-1">
                <span className="h-1.5 w-3 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <div className="h-40">
        {data.length < 2 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-[var(--lp-subtle)]">Not enough samples yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <Kind data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={tick} tick={{ fill: "#77777f", fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis width={52} domain={[0, max ?? "auto"]} tickFormatter={(v) => (axisFormat ?? format)(Number(v))} tick={{ fill: "#77777f", fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(v) => formatDateTime(Number(v))}
                formatter={(v, name) => [format(Number(v)), series.find((s) => s.key === name)?.label ?? String(name)]}
              />
              {series.map((s) =>
                series.length > 1 ? (
                  <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                ) : (
                  <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} fill={s.color} fillOpacity={0.12} strokeWidth={1.75} dot={false} isAnimationActive={false} />
                ),
              )}
            </Kind>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function HostDetail({ host }: { host: Host }) {
  const [range, setRange] = useState<Range>("24h");
  const series = useQuery({
    queryKey: ["host-series", host.id, range],
    queryFn: () => apiRequest<HostSeriesResponse>(`/api/hosts?id=${host.id}&range=${range}`),
    refetchInterval: 60_000,
  });
  const data = (series.data?.points ?? []).map((p) => ({ ...p, ts: new Date(p.at).getTime() }));
  const info = (host.info ?? {}) as HostInfo;
  const latest = host.latest;
  const pctFmt = (v: number) => `${v.toFixed(0)}%`;

  return (
    <div className="grid gap-4 border-t border-[var(--lp-border)] bg-white/[0.015] px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-[var(--lp-subtle)]">{latest ? `Last sample ${formatDateTime(host.latest_at)}` : "Waiting for the first sample"}</span>
        <div className="flex rounded-lg border border-[var(--lp-border)] p-0.5" role="tablist" aria-label="Time range">
          {ranges.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={cn("rounded-md px-2.5 py-1 text-[12px]", range === r ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]")}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {series.isError ? <p className="text-[12px] text-[#ff8fb3]">{(series.error as ApiError).message}</p> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <Chart title="CPU" data={data} series={[{ key: "cpu", label: "CPU", color: "#ff3d7f" }]} format={pctFmt} max={100} />
        <Chart title="Memory" data={data} series={[{ key: "mem_pct", label: "Memory", color: "#a78bfa" }]} format={pctFmt} max={100} />
        <Chart title="Fullest disk" data={data} series={[{ key: "disk_pct", label: "Disk", color: "#fbbf24" }]} format={pctFmt} max={100} />
        <Chart
          title="Network"
          data={data}
          series={[
            { key: "net_rx_bps", label: "In", color: "#38bdf8" },
            { key: "net_tx_bps", label: "Out", color: "#4ade80" },
          ]}
          format={formatRate}
          axisFormat={formatRateShort}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-[12px] text-[var(--lp-muted)]">Disks</p>
          {latest?.disks.length ? (
            <ul className="grid gap-1.5">
              {latest.disks.map((d) => (
                <li key={d.mount} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-[12px]">
                  <span className="lp-mono truncate" title={`${d.mount} (${d.fstype})`}>
                    {d.mount} <span className="text-[var(--lp-subtle)]">{d.fstype}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-[var(--lp-subtle)]">
                      {formatBytes(d.used)} of {formatBytes(d.total)}
                    </span>
                    <Meter value={(d.used / d.total) * 100} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-[var(--lp-subtle)]">No disks reported.</p>
          )}
        </div>
        <DefinitionList
          items={[
            { label: "Operating system", value: `${osLabel(host)}${info.arch ? ` (${info.arch})` : ""}` },
            { label: "Kernel", value: info.kernel || "–" },
            { label: "CPU", value: info.cpu_model ? `${info.cpu_model}, ${info.cores} threads` : info.cores ? `${info.cores} threads` : "–" },
            { label: "Memory", value: latest ? `${formatBytes(latest.mem_used)} of ${formatBytes(latest.mem_total)}` : "–" },
            { label: "Swap", value: latest?.swap_total ? `${formatBytes(latest.swap_used)} of ${formatBytes(latest.swap_total)}` : "None" },
            { label: "Load", value: info.os === "windows" ? "Not on Windows" : latest ? `${latest.load1.toFixed(2)} · ${latest.load5.toFixed(2)} · ${latest.load15.toFixed(2)}` : "–" },
            { label: "Processes", value: latest ? String(latest.procs) : "–" },
            { label: "Uptime", value: formatUptime(latest?.uptime) },
            ...(info.virtualization ? [{ label: "Virtualization", value: info.virtualization }] : []),
            { label: "Agent", value: `${host.version || "–"} · ${host.remote_ip || "–"}` },
          ]}
        />
      </div>
    </div>
  );
}

export function HostsWorkspace() {
  const [open, setOpen] = useState<number | null>(null);
  const list = useQuery({ queryKey: ["hosts"], queryFn: () => apiRequest<HostListResponse>("/api/hosts"), refetchInterval: 30_000 });
  const hosts = list.data?.hosts ?? [];
  const reporting = hosts.filter((h) => h.online && h.latest);
  const avgCPU = reporting.length ? reporting.reduce((s, h) => s + h.latest!.cpu, 0) / reporting.length : null;
  const memHigh = reporting.filter((h) => (pct(h.latest!.mem_used, h.latest!.mem_total) ?? 0) >= WARN).length;
  const diskHigh = reporting.filter((h) => {
    const d = fullestDisk(h);
    return d && (d.used / d.total) * 100 >= WARN;
  }).length;
  const offline = hosts.filter((h) => !h.online).length;
  const critical = hosts.filter((h) => hostHealth(h) === "critical").length;
  const oldAgents = hosts.filter((h) => h.online && !h.latest && h.version && h.version < "0.2.0").length;

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="Hosts"
        description="CPU, memory, disk, and network of every machine running a Qnetward agent. Agents sample once a minute and keep up to an hour of samples if the console can't be reached."
        status={hosts.length ? <RunStatus tone={critical ? "error" : "done"} label={critical ? `${critical} critical` : `${reporting.length} reporting`} /> : null}
      />

      {list.isError ? (
        <p className="text-[13px] text-[#ff8fb3]">{(list.error as ApiError).message}</p>
      ) : list.isSuccess && hosts.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--lp-border)] px-6 py-12 text-center">
          <Server className="h-6 w-6 text-[var(--lp-subtle)]" />
          <p className="mt-3 text-[14px] text-[var(--lp-muted)]">No hosts yet</p>
          <p className="mt-1 max-w-md text-[13px] text-[var(--lp-subtle)]">Every machine that runs a Qnetward agent shows up here. Add an agent and run it on a server to start.</p>
          <Link href="/agents" className="console-btn console-btn-primary mt-4 h-9 px-4">
            Add an agent
          </Link>
        </div>
      ) : (
        <>
          <StatStrip
            items={[
              { label: "Hosts", value: String(hosts.length) },
              { label: "Reporting", value: String(reporting.length), tone: reporting.length ? "good" : undefined },
              { label: "Avg CPU", value: avgCPU == null ? "–" : `${avgCPU.toFixed(0)}%`, tone: avgCPU != null && avgCPU >= WARN ? "warn" : undefined },
              { label: `Memory ≥ ${WARN}%`, value: String(memHigh), tone: memHigh ? "warn" : undefined },
              { label: `Disk ≥ ${WARN}%`, value: String(diskHigh), tone: diskHigh ? "bad" : undefined },
              { label: "Offline", value: String(offline), tone: offline ? "bad" : undefined },
            ]}
          />
          {oldAgents ? (
            <p className="rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2.5 text-[12px] text-[var(--lp-muted)]">
              {oldAgents === 1 ? "One agent runs" : `${oldAgents} agents run`} a version without host metrics. Update to 0.2.0 or later to see them here.
            </p>
          ) : null}
          <Panel title="Hosts" bodyClassName="p-0">
            {list.isLoading ? (
              <p className="px-4 pb-4 text-[13px] text-[var(--lp-subtle)]">Loading…</p>
            ) : (
              <div className="overflow-x-auto border-t border-[var(--lp-border)]">
                <div className="min-w-[820px]">
                  <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_repeat(3,7.5rem)_5rem_7rem_1.5rem] gap-3 px-4 py-2 text-[11px] uppercase tracking-wide text-[var(--lp-subtle)]">
                    <span>Host</span>
                    <span>OS</span>
                    <span>CPU</span>
                    <span>Memory</span>
                    <span>Disk</span>
                    <span>Uptime</span>
                    <span>Status</span>
                    <span />
                  </div>
                  <ul>
                    {hosts.map((h) => {
                      const disk = fullestDisk(h);
                      const health = hostHealth(h);
                      const isOpen = open === h.id;
                      return (
                        <li key={h.id} className="border-t border-[var(--lp-border)]">
                          <button
                            type="button"
                            onClick={() => setOpen(isOpen ? null : h.id)}
                            aria-expanded={isOpen}
                            className="grid w-full grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_repeat(3,7.5rem)_5rem_7rem_1.5rem] items-center gap-3 px-4 py-3 text-left text-[13px] hover:bg-white/[0.02]"
                          >
                            <span className="min-w-0">
                              <span className="block truncate">{h.name}</span>
                              <span className="lp-mono block truncate text-[11px] text-[var(--lp-subtle)]">{h.hostname || "–"}</span>
                            </span>
                            <span className="truncate text-[12px] text-[var(--lp-muted)]">{osLabel(h)}</span>
                            <Meter value={h.latest ? h.latest.cpu : null} />
                            <Meter value={h.latest ? pct(h.latest.mem_used, h.latest.mem_total) : null} />
                            <Meter value={disk ? (disk.used / disk.total) * 100 : null} />
                            <span className="lp-mono text-[12px] text-[var(--lp-muted)]">{formatUptime(h.latest?.uptime)}</span>
                            <span className={cn("text-[12px]", healthMeta[health].className)}>{healthMeta[health].label}</span>
                            <ChevronDown className={cn("h-4 w-4 text-[var(--lp-subtle)] transition-transform", isOpen && "rotate-180")} />
                          </button>
                          {isOpen ? <HostDetail host={h} /> : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
