"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, HardDrive, Trash2 } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { DeviceInterface, DeviceListResponse, DeviceSeriesResponse, NetworkDevice, ProbeAgentListResponse } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { DefinitionList, PageHeader, Panel, RunStatus, StatStrip } from "@/components/tools/probe-ui";
import { Chart, formatUptime } from "@/features/hosts/hosts-workspace";
import { useLiveInterval } from "@/lib/live";

export function formatBits(bps?: number | null) {
  if (bps == null || !Number.isFinite(bps)) return "–";
  const units = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"];
  let i = 0;
  let v = bps;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

function bitsShort(bps: number) {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)}G`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(0)}M`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)}K`;
  return `${bps.toFixed(0)}`;
}

function speedLabel(bps: number) {
  if (!bps) return "–";
  if (bps >= 1e9) return `${bps / 1e9}G`;
  if (bps >= 1e6) return `${bps / 1e6}M`;
  return `${bps / 1e3}K`;
}

const statusMeta: Record<NetworkDevice["status"], { label: string; className: string }> = {
  up: { label: "Up", className: "text-[#86efac]" },
  down: { label: "Unreachable", className: "text-[#ff8fb3]" },
  unknown: { label: "Waiting", className: "text-[var(--lp-subtle)]" },
};

function deviceState(d: NetworkDevice) {
  if (!d.enabled) return { label: "Paused", className: "text-[var(--lp-subtle)]" };
  if (!d.agent_id) return { label: "No agent", className: "text-[#fcd34d]" };
  if (!d.agent_online && d.status !== "down") return { label: "Agent offline", className: "text-[#fcd34d]" };
  return statusMeta[d.status];
}

function ifCounts(d: NetworkDevice) {
  const ifs = d.interfaces ?? [];
  return {
    up: ifs.filter((f) => f.oper === "up").length,
    down: ifs.filter((f) => f.oper !== "up" && f.admin === "up").length,
    total: ifs.length,
    in: ifs.reduce((s, f) => s + f.in_bps, 0),
    out: ifs.reduce((s, f) => s + f.out_bps, 0),
  };
}

function utilization(f: DeviceInterface) {
  if (!f.speed_bps || !f.has_rates) return null;
  return (Math.max(f.in_bps, f.out_bps) / f.speed_bps) * 100;
}

function DeviceForm({ device, onDone }: { device?: NetworkDevice; onDone: () => void }) {
  const queryClient = useQueryClient();
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => apiRequest<ProbeAgentListResponse>("/api/agents"), refetchInterval: 10_000 });
  const enrolled = (agents.data?.agents ?? []).filter((a) => a.enrolled);
  const [name, setName] = useState(device?.name ?? "");
  const [address, setAddress] = useState(device?.address ?? "");
  const [port, setPort] = useState(String(device?.port ?? 161));
  const [agent, setAgent] = useState(device?.agent_id ? String(device.agent_id) : "");
  const [version, setVersion] = useState<"2c" | "3">(device?.version ?? "2c");
  const [community, setCommunity] = useState("");
  const [username, setUsername] = useState(device?.credentials.username ?? "");
  const [authProtocol, setAuthProtocol] = useState(device?.credentials.auth_protocol ?? "sha256");
  const [authPassword, setAuthPassword] = useState("");
  const [privProtocol, setPrivProtocol] = useState(device?.credentials.priv_protocol ?? "aes");
  const [privPassword, setPrivPassword] = useState("");
  const [interval, setInterval] = useState(device?.interval_seconds ?? 60);
  const agentValue = agent || (!device && enrolled.length === 1 ? String(enrolled[0].id) : "");

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        id: device?.id,
        name,
        address,
        port: Number(port),
        version,
        agent_id: agentValue ? Number(agentValue) : null,
        interval_seconds: interval,
      };
      if (version === "2c" && community) body.community = community;
      if (version === "3" && (!device || username !== device.credentials.username || authPassword || privPassword)) {
        Object.assign(body, { username, auth_protocol: authProtocol, auth_password: authPassword, priv_protocol: privProtocol, priv_password: privPassword });
      }
      return apiRequest<NetworkDevice>("/api/devices", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["devices"] });
      onDone();
    },
  });

  const field = "grid gap-1 text-xs text-[var(--lp-subtle)]";
  const input = "h-9 px-2 text-sm";
  return (
    <form
      className="grid gap-3 border-t border-[var(--lp-border)] px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={field}>
          Name
          <input className={input} required maxLength={80} placeholder="core-switch" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={field}>
          Address
          <input className={cn(input, "lp-mono")} required placeholder="10.0.0.2" value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className={field}>
          Polled by agent
          <select className={input} required value={agentValue} onChange={(e) => setAgent(e.target.value)}>
            <option value="">{agents.isLoading ? "Loading agents…" : enrolled.length ? "Choose an agent" : "No agents yet"}</option>
            {enrolled.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.online ? "" : " (offline)"}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={field}>
            Port
            <input className={input} type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
          </label>
          <label className={field}>
            Every
            <select className={input} value={interval} onChange={(e) => setInterval(Number(e.target.value))}>
              {[30, 60, 300, 900].map((s) => (
                <option key={s} value={s}>
                  {s < 60 ? `${s}s` : `${s / 60} min`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={field}>
          SNMP version
          <select className={input} value={version} onChange={(e) => setVersion(e.target.value as "2c" | "3")}>
            <option value="2c">v2c (community)</option>
            <option value="3">v3 (user, recommended)</option>
          </select>
        </label>
        {version === "2c" ? (
          <label className={cn(field, "lg:col-span-3")}>
            Community
            <input
              className={input}
              type="password"
              autoComplete="off"
              required={!device || device.version !== "2c"}
              placeholder={device?.credentials.community_set ? "Saved; type to replace" : "Read-only community"}
              value={community}
              onChange={(e) => setCommunity(e.target.value)}
            />
          </label>
        ) : (
          <>
            <label className={field}>
              User
              <input className={input} required autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label className={field}>
              Authentication
              <span className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                <select className={input} value={authProtocol} onChange={(e) => setAuthProtocol(e.target.value)}>
                  {["sha256", "sha512", "sha", "md5", "none"].map((p) => (
                    <option key={p} value={p}>
                      {p.toUpperCase()}
                    </option>
                  ))}
                </select>
                <input className={input} type="password" autoComplete="off" disabled={authProtocol === "none"} placeholder={device ? "Unchanged" : "Passphrase"} value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
              </span>
            </label>
            <label className={field}>
              Privacy
              <span className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
                <select className={input} value={privProtocol} onChange={(e) => setPrivProtocol(e.target.value)}>
                  {["aes", "aes256", "des", "none"].map((p) => (
                    <option key={p} value={p}>
                      {p.toUpperCase()}
                    </option>
                  ))}
                </select>
                <input className={input} type="password" autoComplete="off" disabled={privProtocol === "none"} placeholder={device ? "Unchanged" : "Passphrase"} value={privPassword} onChange={(e) => setPrivPassword(e.target.value)} />
              </span>
            </label>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="console-btn console-btn-primary h-9 px-4" disabled={save.isPending}>
          {save.isPending ? "Saving…" : device ? "Save" : "Add device"}
        </button>
        <button type="button" className="console-btn console-btn-secondary h-9 px-4" onClick={onDone}>
          Cancel
        </button>
        <span className="text-xs text-[var(--lp-subtle)]">
          {agents.isSuccess && !enrolled.length ? (
            <>
              Devices are polled by an agent on the same network.{" "}
              <Link href="/agents" className="text-[var(--lp-text)] hover:underline">
                Add an agent
              </Link>{" "}
              first.
            </>
          ) : (
            "Read-only access is enough. Credentials are encrypted and only sent to the agent that polls the device."
          )}
        </span>
        {save.isError ? <span className="w-full text-xs text-[#ff8fb3]">{(save.error as ApiError).message}</span> : null}
      </div>
    </form>
  );
}

const ranges = ["1h", "6h", "24h", "7d"] as const;

function DeviceDetail({ device, canEdit }: { device: NetworkDevice; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<(typeof ranges)[number]>("6h");
  const [iface, setIface] = useState(0);
  const [editing, setEditing] = useState(false);
  const seriesInterval = useLiveInterval(60_000);
  const series = useQuery({
    queryKey: ["device-series", device.id, range, iface],
    queryFn: () => apiRequest<DeviceSeriesResponse>(`/api/devices?id=${device.id}&range=${range}${iface ? `&if=${iface}` : ""}`),
    refetchInterval: seriesInterval,
  });
  const remove = useMutation({
    mutationFn: () => apiRequest(`/api/devices?id=${device.id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["devices"] }),
  });
  const data = (series.data?.points ?? []).map((p) => ({ ...p, ts: new Date(p.at).getTime() }));
  const ifs = device.interfaces ?? [];
  const chosen = ifs.find((f) => f.index === iface);

  if (editing) return <DeviceForm device={device} onDone={() => setEditing(false)} />;
  return (
    <div className="grid gap-4 border-t border-[var(--lp-border)] bg-white/[0.015] px-4 py-4">
      {device.last_error ? <p className="rounded-lg border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.06)] px-3 py-2 text-xs text-[#ff8fb3]">{device.last_error}</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[var(--lp-subtle)]">
          {chosen ? `Interface ${chosen.name}` : "All interfaces"} · {device.last_polled_at ? `last poll ${formatDateTime(device.last_polled_at)}` : "not polled yet"}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {iface ? (
            <button type="button" className="text-xs text-[var(--lp-muted)] hover:text-[var(--lp-text)]" onClick={() => setIface(0)}>
              Show all interfaces
            </button>
          ) : null}
          <div className="flex rounded-lg border border-[var(--lp-border)] p-0.5" role="tablist" aria-label="Time range">
            {ranges.map((r) => (
              <button
                key={r}
                type="button"
                role="tab"
                aria-selected={range === r}
                onClick={() => setRange(r)}
                className={cn("rounded-md px-2.5 py-1 text-xs", range === r ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]")}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Chart
          title={chosen ? `${chosen.name} traffic` : "Traffic, all interfaces"}
          data={data}
          series={[
            { key: "in_bps", label: "In", color: "#38bdf8" },
            { key: "out_bps", label: "Out", color: "#4ade80" },
          ]}
          format={formatBits}
          axisFormat={bitsShort}
        />
        <Chart title={chosen ? `${chosen.name} errors per second` : "Errors per second"} data={data} series={[{ key: "errors_ps", label: "Errors", color: "#ff3d7f" }]} format={(v) => v.toFixed(2)} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--lp-border)]">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="text-left text-2xs uppercase tracking-wide text-[var(--lp-subtle)]">
            <tr>
              <th className="px-3 py-2 font-normal">Interface</th>
              <th className="px-3 py-2 font-normal">Status</th>
              <th className="px-3 py-2 font-normal">Speed</th>
              <th className="px-3 py-2 text-right font-normal">In</th>
              <th className="px-3 py-2 text-right font-normal">Out</th>
              <th className="px-3 py-2 text-right font-normal">Use</th>
              <th className="px-3 py-2 text-right font-normal">Errors/s</th>
            </tr>
          </thead>
          <tbody>
            {ifs.map((f) => {
              const use = utilization(f);
              const errs = f.in_errors_ps + f.out_errors_ps;
              return (
                <tr
                  key={f.index}
                  onClick={() => setIface(f.index === iface ? 0 : f.index)}
                  className={cn("cursor-pointer border-t border-[var(--lp-border)] hover:bg-white/[0.03]", f.index === iface && "bg-white/[0.05]")}
                >
                  <td className="px-3 py-2">
                    <span className="lp-mono">{f.name}</span>
                    {f.alias ? <span className="ml-2 text-[var(--lp-subtle)]">{f.alias}</span> : null}
                  </td>
                  <td className={cn("px-3 py-2", f.oper === "up" ? "text-[#86efac]" : f.admin === "up" ? "text-[#ff8fb3]" : "text-[var(--lp-subtle)]")}>
                    {f.admin !== "up" ? "Disabled" : f.oper === "up" ? "Up" : "Down"}
                  </td>
                  <td className="lp-mono px-3 py-2 text-[var(--lp-muted)]">{speedLabel(f.speed_bps)}</td>
                  <td className="lp-mono px-3 py-2 text-right">{f.has_rates ? formatBits(f.in_bps) : "–"}</td>
                  <td className="lp-mono px-3 py-2 text-right">{f.has_rates ? formatBits(f.out_bps) : "–"}</td>
                  <td className={cn("lp-mono px-3 py-2 text-right", use != null && use >= 80 ? "text-[#fcd34d]" : "")}>{use == null ? "–" : `${use.toFixed(use < 1 ? 1 : 0)}%`}</td>
                  <td className={cn("lp-mono px-3 py-2 text-right", errs > 0 ? "text-[#ff8fb3]" : "text-[var(--lp-subtle)]")}>{f.has_rates ? errs.toFixed(2) : "–"}</td>
                </tr>
              );
            })}
            {ifs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-[var(--lp-subtle)]">
                  No interfaces reported yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <DefinitionList
          items={[
            { label: "System name", value: device.sys?.name || "–" },
            { label: "Description", value: device.sys?.descr || "–" },
            { label: "Uptime", value: formatUptime(device.sys?.uptime_s) },
            { label: "Location", value: device.sys?.location || "–" },
            { label: "Contact", value: device.sys?.contact || "–" },
            { label: "SNMP", value: `v${device.version} · ${device.address}:${device.port} · every ${device.interval_seconds < 60 ? `${device.interval_seconds}s` : `${device.interval_seconds / 60} min`}` },
            { label: "Agent", value: device.agent_name ? `${device.agent_name}${device.agent_online ? "" : " (offline)"}` : "None" },
          ]}
        />
        {canEdit ? (
          <div className="flex items-start gap-2">
            <button type="button" className="console-btn console-btn-secondary h-8 px-3 text-xs" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className="console-btn h-8 gap-1.5 bg-[rgba(255,61,127,0.12)] px-3 text-xs text-[#ff8fb3] hover:bg-[rgba(255,61,127,0.22)]"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Remove ${device.name} and its history?`)) remove.mutate();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function DevicesWorkspace() {
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const listInterval = useLiveInterval(30_000, 60_000);
  const list = useQuery({ queryKey: ["devices"], queryFn: () => apiRequest<DeviceListResponse>("/api/devices"), refetchInterval: listInterval });
  const workspace = useQuery({ queryKey: ["workspace-general"], queryFn: () => apiRequest<{ workspace: { role: string } }>("/api/workspace") });
  const canEdit = ["owner", "admin"].includes(workspace.data?.workspace.role ?? "");
  const devices = list.data?.devices ?? [];
  const up = devices.filter((d) => d.status === "up").length;
  const unreachable = devices.filter((d) => d.status === "down").length;
  const counts = devices.map(ifCounts);
  const ifDown = counts.reduce((s, c) => s + c.down, 0);
  const traffic = counts.reduce((s, c) => s + c.in + c.out, 0);
  const atLimit = list.data ? list.data.limit > 0 && devices.length >= list.data.limit : false;

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="Network devices"
        description="Routers, switches, and firewalls polled over SNMP by an agent on the same network. See each interface's status, traffic, utilization, and errors."
        status={devices.length ? <RunStatus tone={unreachable ? "error" : "done"} label={unreachable ? `${unreachable} unreachable` : `${up} up`} /> : null}
      />

      {list.isError ? <p className="text-sm text-[#ff8fb3]">{(list.error as ApiError).message}</p> : null}
      {list.isSuccess && devices.length === 0 && !adding ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--lp-border)] px-6 py-12 text-center">
          <HardDrive className="h-6 w-6 text-[var(--lp-subtle)]" />
          <p className="mt-3 text-base text-[var(--lp-muted)]">No network devices yet</p>
          <p className="mt-1 max-w-md text-sm text-[var(--lp-subtle)]">
            Turn on SNMP (v3 if you can) on a router or switch, run an agent on a machine that can reach it, then add the device here.
          </p>
          <div className="mt-4 flex gap-2">
            {canEdit ? (
              <button type="button" className="console-btn console-btn-primary h-9 px-4" onClick={() => setAdding(true)}>
                Add device
              </button>
            ) : null}
            <Link href="/agents" className="console-btn console-btn-secondary h-9 px-4">
              Agents
            </Link>
          </div>
        </div>
      ) : list.isSuccess ? (
        <>
          <StatStrip
            items={[
              { label: "Devices", value: String(devices.length) },
              { label: "Up", value: String(up), tone: up ? "good" : undefined },
              { label: "Unreachable", value: String(unreachable), tone: unreachable ? "bad" : undefined },
              { label: "Interfaces up", value: String(counts.reduce((s, c) => s + c.up, 0)) },
              { label: "Interfaces down", value: String(ifDown), tone: ifDown ? "warn" : undefined },
              { label: "Traffic now", value: formatBits(traffic) },
            ]}
          />
          <Panel
            title="Devices"
            bodyClassName="p-0"
            aside={
              canEdit && !adding ? (
                <button type="button" className="console-btn console-btn-secondary h-8 px-3 text-xs" disabled={atLimit} title={atLimit ? "Your plan's device limit is reached" : undefined} onClick={() => setAdding(true)}>
                  Add device
                </button>
              ) : null
            }
          >
            {adding ? <DeviceForm onDone={() => setAdding(false)} /> : null}
            {devices.length ? (
              <div className="overflow-x-auto border-t border-[var(--lp-border)]">
                <div className="min-w-[820px]">
                  <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_7rem_7rem_8rem_7rem_1.5rem] gap-3 px-4 py-2 text-2xs uppercase tracking-wide text-[var(--lp-subtle)]">
                    <span>Device</span>
                    <span>System</span>
                    <span>Interfaces</span>
                    <span>Uptime</span>
                    <span>Traffic</span>
                    <span>Status</span>
                    <span />
                  </div>
                  <ul>
                    {devices.map((d) => {
                      const c = ifCounts(d);
                      const state = deviceState(d);
                      const isOpen = open === d.id;
                      return (
                        <li key={d.id} className="border-t border-[var(--lp-border)]">
                          <button
                            type="button"
                            onClick={() => setOpen(isOpen ? null : d.id)}
                            aria-expanded={isOpen}
                            className="grid w-full grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_7rem_7rem_8rem_7rem_1.5rem] items-center gap-3 px-4 py-3 text-left text-sm hover:bg-white/[0.02]"
                          >
                            <span className="min-w-0">
                              <span className="block truncate">{d.name}</span>
                              <span className="lp-mono block truncate text-2xs text-[var(--lp-subtle)]">{d.address}</span>
                            </span>
                            <span className="truncate text-xs text-[var(--lp-muted)]" title={d.sys?.descr}>
                              {d.sys?.name || d.sys?.descr || "–"}
                            </span>
                            <span className="text-xs">
                              {c.total ? (
                                <>
                                  <span className="text-[#86efac]">{c.up} up</span>
                                  {c.down ? <span className="text-[#ff8fb3]"> · {c.down} down</span> : null}
                                </>
                              ) : (
                                "–"
                              )}
                            </span>
                            <span className="lp-mono text-xs text-[var(--lp-muted)]">{formatUptime(d.sys?.uptime_s)}</span>
                            <span className="lp-mono text-xs text-[var(--lp-muted)]">{c.total ? formatBits(c.in + c.out) : "–"}</span>
                            <span className={cn("text-xs", state.className)}>{state.label}</span>
                            <ChevronDown className={cn("h-4 w-4 text-[var(--lp-subtle)] transition-transform", isOpen && "rotate-180")} />
                          </button>
                          {isOpen ? <DeviceDetail device={d} canEdit={canEdit} /> : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            ) : null}
          </Panel>
        </>
      ) : list.isLoading ? (
        <p className="text-sm text-[var(--lp-subtle)]">Loading…</p>
      ) : null}
    </div>
  );
}
