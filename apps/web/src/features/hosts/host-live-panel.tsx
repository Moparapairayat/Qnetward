"use client";

import { Area, AreaChart, Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { useLiveReadings } from "@/lib/live-bus";
import type { HostSample } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/features/hosts/hosts-workspace";

const pct = (used: number, total: number) => (total ? (used / total) * 100 : 0);
const rate = (bps: number) => `${formatBytes(bps)}/s`;

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "bad" }) {
  return (
    <div className="bg-[#1b1b1f] px-4 py-3">
      <div className="text-xs text-[var(--lp-subtle)]">{label}</div>
      <div className={cn("lp-mono mt-1 text-xl transition-colors", tone === "bad" ? "text-[#ff8fb3]" : tone === "warn" ? "text-[#fcd34d]" : "text-[var(--lp-text)]")}>{value}</div>
      {sub ? <div className="mt-0.5 text-2xs text-[var(--lp-subtle)]">{sub}</div> : null}
    </div>
  );
}

const level = (v: number): "warn" | "bad" | undefined => (v >= 95 ? "bad" : v >= 85 ? "warn" : undefined);

/** Second-by-second readings of a host while its page is open. */
export function HostLivePanel({ hostId, online }: { hostId: number; online: boolean }) {
  const { readings, streaming, error } = useLiveReadings<HostSample>("host", hostId);
  const last = readings[readings.length - 1]?.sample;
  const data = readings.map((r) => ({
    at: r.at,
    cpu: r.sample.cpu,
    mem: pct(r.sample.mem_used, r.sample.mem_total),
    rx: r.sample.net_rx_bps,
    tx: r.sample.net_tx_bps,
  }));
  const memPct = last ? pct(last.mem_used, last.mem_total) : 0;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--lp-border)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--lp-border)] bg-white/[0.015] px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm">
          <span className={cn("relative flex h-2 w-2", !streaming && "opacity-50")}>
            {streaming ? <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4ade80] opacity-60" /> : null}
            <span className={cn("relative inline-flex h-2 w-2 rounded-full", streaming ? "bg-[#4ade80]" : "bg-[var(--lp-subtle)]")} />
          </span>
          <span className="font-medium">Live</span>
          <span className="text-xs text-[var(--lp-subtle)]">
            {streaming ? "every second, while this page is open" : !online ? "the agent is offline" : error ? error : "connecting to the agent…"}
          </span>
        </span>
        <span className="text-2xs text-[var(--lp-subtle)]">last 90 seconds</span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-[var(--lp-border)] lg:grid-cols-4">
        <Tile label="CPU" value={last ? `${last.cpu.toFixed(1)}%` : "–"} sub={last && last.load1 ? `load ${last.load1.toFixed(2)}` : undefined} tone={last ? level(last.cpu) : undefined} />
        <Tile label="Memory" value={last ? `${memPct.toFixed(1)}%` : "–"} sub={last ? `${formatBytes(last.mem_used)} of ${formatBytes(last.mem_total)}` : undefined} tone={level(memPct)} />
        <Tile label="Network in" value={last ? rate(last.net_rx_bps) : "–"} />
        <Tile label="Network out" value={last ? rate(last.net_tx_bps) : "–"} sub={last ? `${last.procs} processes` : undefined} />
      </div>
      <div className="grid gap-px bg-[var(--lp-border)] lg:grid-cols-2">
        <div className="h-28 bg-[#18181b] px-2 pt-2">
          {data.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 4, right: 6, bottom: 4, left: 6 }}>
                <YAxis hide domain={[0, 100]} />
                <Line type="monotone" dataKey="cpu" stroke="#ff3d7f" strokeWidth={1.75} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="mem" stroke="#a78bfa" strokeWidth={1.75} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-[var(--lp-subtle)]">CPU and memory appear here</div>
          )}
        </div>
        <div className="h-28 bg-[#18181b] px-2 pt-2">
          {data.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 4, right: 6, bottom: 4, left: 6 }}>
                <YAxis hide domain={[0, "auto"]} />
                <Area type="monotone" dataKey="rx" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.12} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="tx" stroke="#4ade80" fill="#4ade80" fillOpacity={0.1} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-[var(--lp-subtle)]">Network in and out appear here</div>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-4 border-t border-[var(--lp-border)] px-4 py-2 text-2xs text-[var(--lp-subtle)]">
        {[
          ["#ff3d7f", "CPU"],
          ["#a78bfa", "Memory"],
          ["#38bdf8", "In"],
          ["#4ade80", "Out"],
        ].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="h-1.5 w-3 rounded-full" style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
