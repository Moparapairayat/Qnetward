"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Copy, Route, Waypoints } from "@/components/icons";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/api";
import type { TracerouteHop, TracerouteResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Field, PageHeader, Panel, RunStatus, StatStrip } from "@/components/tools/probe-ui";

const ms = (v?: number) => (typeof v === "number" && v > 0 ? (v >= 100 ? `${Math.round(v)}` : v.toFixed(1)) : "—");

/** Latency tone, so a jump between two hops stands out. */
function latencyColor(v: number) {
  if (v < 50) return "#4ade80";
  if (v < 150) return "#fbbf24";
  return "#ff5c5c";
}

/** The trace as plain text, in the shape people paste into tickets. */
function asText(res: TracerouteResult) {
  const lines = [`traceroute to ${res.target} (${res.addr}), ${res.hops.length} hops`];
  for (const h of res.hops) {
    const host = h.addr ? `${h.name ? `${h.name} (${h.addr})` : h.addr}` : "*";
    const rtts = h.rtts_ms.map((v) => (v < 0 ? "*" : `${v.toFixed(2)} ms`)).join("  ");
    lines.push(`${String(h.ttl).padStart(2)}  ${host}  ${rtts}`);
  }
  return lines.join("\n");
}

function HopRow({ hop, scale }: { hop: TracerouteHop; scale: number }) {
  const silent = !hop.addr;
  return (
    <tr className={cn("border-t border-[var(--lp-border)] align-middle", hop.reached && "bg-[rgba(74,222,128,0.04)]")}>
      <td className="lp-mono w-10 px-4 py-2.5 text-right text-xs text-[var(--lp-subtle)]">{hop.ttl}</td>
      <td className="min-w-0 px-3 py-2.5">
        {silent ? (
          <span className="text-sm text-[var(--lp-subtle)]">No reply</span>
        ) : (
          <div className="min-w-0">
            <p className="truncate text-sm text-[var(--lp-text)]" title={hop.name || hop.addr}>
              {hop.name || hop.addr}
              {hop.reached ? <span className="ml-2 rounded border border-[rgba(74,222,128,0.3)] px-1.5 text-3xs text-[#86efac]">Destination</span> : null}
            </p>
            {hop.name ? <p className="lp-mono truncate text-2xs text-[var(--lp-subtle)]">{hop.addr}</p> : null}
          </div>
        )}
      </td>
      <td className="lp-mono px-3 py-2.5 text-right text-xs" style={{ color: hop.loss_percent === 0 ? "var(--lp-muted)" : hop.loss_percent >= 100 ? "var(--lp-subtle)" : "#fbbf24" }}>
        {hop.loss_percent}%
      </td>
      <td className="lp-mono hidden px-3 py-2.5 text-right text-xs text-[var(--lp-muted)] sm:table-cell">{ms(hop.best_ms)}</td>
      <td className="lp-mono px-3 py-2.5 text-right text-xs text-[var(--lp-text)]">{ms(hop.avg_ms)}</td>
      <td className="lp-mono hidden px-3 py-2.5 text-right text-xs text-[var(--lp-muted)] sm:table-cell">{ms(hop.worst_ms)}</td>
      <td className="hidden w-[28%] px-4 py-2.5 md:table-cell">
        {hop.avg_ms ? (
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (hop.avg_ms / scale) * 100)}%`, background: latencyColor(hop.avg_ms) }} />
          </div>
        ) : null}
      </td>
    </tr>
  );
}

export function TracerouteWorkspace() {
  const searchParams = useSearchParams();
  const [target, setTarget] = useState("");
  const [maxHops, setMaxHops] = useState(30);
  const [queries, setQueries] = useState(3);
  const [ipv6, setIPv6] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = searchParams.get("target")?.trim();
    // Prefill from links such as the overview's targets table.
    if (t) setTarget(t); // eslint-disable-line react-hooks/set-state-in-effect
  }, [searchParams]);

  const trace = useMutation({
    mutationFn: () =>
      apiRequest<TracerouteResult>("/api/traceroute", {
        method: "POST",
        body: JSON.stringify({ target: target.trim(), max_hops: maxHops, queries, ipv6 }),
      }),
  });
  const res = trace.data;
  const answered = res?.hops.filter((h) => h.addr) ?? [];
  const scale = Math.max(1, ...answered.map((h) => h.worst_ms ?? h.avg_ms ?? 0));
  const last = res?.hops[res.hops.length - 1];
  const worstLoss = answered.filter((h) => !h.reached).reduce<TracerouteHop | null>((w, h) => (!w || h.loss_percent > w.loss_percent ? h : w), null);
  const silent = res ? res.hops.filter((h) => !h.addr).length : 0;

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="Traceroute"
        description="Follow the path from Qnetward to a host, router by router, with the delay and loss at each hop. Use it to see where a slow or failing route goes wrong."
        status={
          trace.isPending ? (
            <RunStatus tone="live" label="Tracing…" />
          ) : res ? (
            <RunStatus tone={res.reached ? "live" : "error"} label={res.reached ? `Reached in ${res.hops.length} hops` : "Destination didn't answer"} />
          ) : null
        }
      />

      <form
        className="rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (target.trim()) trace.mutate();
        }}
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_140px_auto] md:items-end">
          <Field label="Host or IP">
            <input id="trace-target" className="h-10 w-full px-3" placeholder="example.com or 1.1.1.1" autoComplete="off" value={target} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <Field label="Max hops">
            <select className="h-10 w-full px-2" value={maxHops} onChange={(e) => setMaxHops(Number(e.target.value))}>
              {[15, 30, 40].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Probes per hop">
            <select className="h-10 w-full px-2" value={queries} onChange={(e) => setQueries(Number(e.target.value))}>
              {[1, 3, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="console-btn console-btn-primary h-10 px-5" disabled={trace.isPending || !target.trim()}>
            <Route className="h-3.5 w-3.5" /> {trace.isPending ? "Tracing…" : "Trace"}
          </button>
        </div>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-xs text-[var(--lp-muted)]">
          <input type="checkbox" className="accent-[var(--lp-accent)]" checked={ipv6} onChange={(e) => setIPv6(e.target.checked)} /> Use IPv6
        </label>
        {trace.isError ? (
          <p className="mt-4 rounded-lg border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] px-3 py-2.5 text-sm text-[#ff8fb3]">
            {(trace.error as ApiError).message}
          </p>
        ) : null}
      </form>

      {trace.isPending ? (
        <div className="rounded-xl border border-dashed border-[var(--lp-border)] px-6 py-14 text-center">
          <Waypoints className="mx-auto h-5 w-5 animate-pulse text-[var(--lp-accent)]" />
          <p className="mt-3 text-sm text-[var(--lp-muted)]">Sending probes to every hop at once</p>
          <p className="mt-1 text-xs text-[var(--lp-subtle)]">A trace usually takes 3 to 8 seconds.</p>
        </div>
      ) : !res ? (
        <div className="rounded-xl border border-dashed border-[var(--lp-border)] px-6 py-14 text-center">
          <Waypoints className="mx-auto h-5 w-5 text-[var(--lp-subtle)]" />
          <p className="mt-3 text-sm text-[var(--lp-muted)]">Trace a host to see the route to it</p>
          <p className="mt-1 text-xs text-[var(--lp-subtle)]">Some routers never answer traceroute; a hop with no reply is normal when the hops after it answer.</p>
        </div>
      ) : (
        <>
          <StatStrip
            items={[
              { label: "Hops", value: String(res.hops.length) },
              { label: "Destination", value: res.reached ? "Reached" : "No answer", tone: res.reached ? "good" : "bad" },
              { label: "End-to-end", value: res.reached && last?.avg_ms ? `${ms(last.avg_ms)} ms` : "—" },
              { label: "Worst loss", value: worstLoss && worstLoss.loss_percent > 0 ? `${worstLoss.loss_percent}% at hop ${worstLoss.ttl}` : "None", tone: worstLoss && worstLoss.loss_percent > 0 ? "warn" : undefined },
              { label: "Silent hops", value: String(silent) },
              { label: "Took", value: `${(res.duration_ms / 1000).toFixed(1)} s` },
            ]}
          />
          <Panel
            title={`Route to ${res.target}${res.addr !== res.target ? ` (${res.addr})` : ""}`}
            bodyClassName="p-0 pt-3"
            aside={
              <button
                type="button"
                className="console-btn console-btn-secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(asText(res)).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-[var(--lp-green)]" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy as text"}
              </button>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] table-fixed text-left">
                <thead>
                  <tr className="text-2xs text-[var(--lp-subtle)]">
                    <th className="w-10 px-4 pb-2 text-right font-normal">#</th>
                    <th className="px-3 pb-2 font-normal">Host</th>
                    <th className="w-16 px-3 pb-2 text-right font-normal">Loss</th>
                    <th className="hidden w-16 px-3 pb-2 text-right font-normal sm:table-cell">Best</th>
                    <th className="w-16 px-3 pb-2 text-right font-normal">Avg</th>
                    <th className="hidden w-16 px-3 pb-2 text-right font-normal sm:table-cell">Worst</th>
                    <th className="hidden w-[28%] px-4 pb-2 font-normal md:table-cell">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {res.hops.map((h) => (
                    <HopRow key={h.ttl} hop={h} scale={scale} />
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
