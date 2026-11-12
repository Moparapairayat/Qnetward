"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { Host, HostAlertRule, HostAlertRuleList, HostMetric } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { Panel } from "@/components/tools/probe-ui";

const metricLabel: Record<HostMetric, string> = { cpu: "CPU", memory: "Memory", disk: "Disk", swap: "Swap" };
const metricHint: Record<HostMetric, string> = {
  cpu: "Average across all cores",
  memory: "Memory in use",
  disk: "The fullest disk",
  swap: "Swap in use",
};
const minuteOptions = [1, 5, 10, 15, 30, 60];

// Starting points most teams use.
const presets: { metric: HostMetric; threshold: number; minutes: number }[] = [
  { metric: "cpu", threshold: 90, minutes: 10 },
  { metric: "memory", threshold: 90, minutes: 10 },
  { metric: "disk", threshold: 90, minutes: 5 },
];

function RuleForm({ hosts, onDone }: { hosts: Host[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [agent, setAgent] = useState<string>("");
  const [metric, setMetric] = useState<HostMetric>("cpu");
  const [threshold, setThreshold] = useState("90");
  const [minutes, setMinutes] = useState(10);
  const [email, setEmail] = useState("");
  const save = useMutation({
    mutationFn: () =>
      apiRequest<HostAlertRule>("/api/hosts/alerts", {
        method: "POST",
        body: JSON.stringify({ agent_id: agent ? Number(agent) : null, metric, threshold: Number(threshold), minutes, notify_email: email.trim() }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["host-alerts"] });
      onDone();
    },
  });

  return (
    <form
      className="grid gap-3 border-t border-[var(--lp-border)] px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p.metric}
            type="button"
            className="rounded-md border border-[var(--lp-border)] px-2.5 py-1 text-[12px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
            onClick={() => {
              setMetric(p.metric);
              setThreshold(String(p.threshold));
              setMinutes(p.minutes);
            }}
          >
            {metricLabel[p.metric]} ≥ {p.threshold}% for {p.minutes} min
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_7rem_8rem_minmax(0,1.4fr)]">
        <label className="grid gap-1 text-[12px] text-[var(--lp-subtle)]">
          Host
          <select className="h-9 px-2 text-[13px]" value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">Every host</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] text-[var(--lp-subtle)]">
          Metric
          <select className="h-9 px-2 text-[13px]" value={metric} onChange={(e) => setMetric(e.target.value as HostMetric)}>
            {(Object.keys(metricLabel) as HostMetric[]).map((m) => (
              <option key={m} value={m}>
                {metricLabel[m]} · {metricHint[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] text-[var(--lp-subtle)]">
          At or above
          <span className="flex items-center gap-1.5">
            <input className="h-9 w-full px-2 text-[13px]" type="number" min={1} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            <span className="text-[13px] text-[var(--lp-muted)]">%</span>
          </span>
        </label>
        <label className="grid gap-1 text-[12px] text-[var(--lp-subtle)]">
          For
          <select className="h-9 px-2 text-[13px]" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {minuteOptions.map((m) => (
              <option key={m} value={m}>
                {m} {m === 1 ? "minute" : "minutes"}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] text-[var(--lp-subtle)]">
          Email (optional)
          <input className="h-9 px-2 text-[13px]" type="email" placeholder="ops@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="console-btn console-btn-primary h-9 px-4" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Add rule"}
        </button>
        <button type="button" className="console-btn console-btn-secondary h-9 px-4" onClick={onDone}>
          Cancel
        </button>
        <span className="text-[12px] text-[var(--lp-subtle)]">Alerts also go to channels that subscribe to Hosts in Integrations.</span>
        {save.isError ? <span className="w-full text-[12px] text-[#ff8fb3]">{(save.error as ApiError).message}</span> : null}
      </div>
    </form>
  );
}

function RuleRow({ rule, hosts, canEdit }: { rule: HostAlertRule; hosts: Host[]; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["host-alerts"] });
  const toggle = useMutation({
    mutationFn: () =>
      apiRequest("/api/hosts/alerts", {
        method: "POST",
        body: JSON.stringify({ id: rule.id, agent_id: rule.agent_id, metric: rule.metric, threshold: rule.threshold, minutes: rule.minutes, notify_email: rule.notify_email, enabled: !rule.enabled }),
      }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => apiRequest(`/api/hosts/alerts?id=${rule.id}`, { method: "DELETE" }), onSuccess: refresh });
  const name = (id: number) => hosts.find((h) => h.id === id)?.name ?? `Host ${id}`;
  const firing = rule.firing.length > 0;

  return (
    <li className="grid gap-1.5 border-t border-[var(--lp-border)] px-4 py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span
          className={cn(
            "inline-flex rounded-md border px-1.5 py-0.5 text-[11px]",
            !rule.enabled
              ? "border-[var(--lp-border)] text-[var(--lp-subtle)]"
              : firing
                ? "border-[rgba(255,61,127,0.45)] bg-[rgba(255,61,127,0.15)] text-[#ff8fb3]"
                : "border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.08)] text-[#86efac]",
          )}
        >
          {!rule.enabled ? "Paused" : firing ? `Firing on ${rule.firing.length}` : "OK"}
        </span>
        <span className="text-[13px]">
          {metricLabel[rule.metric]} ≥ {rule.threshold}% for {rule.minutes} {rule.minutes === 1 ? "minute" : "minutes"}
        </span>
        <span className="text-[12px] text-[var(--lp-subtle)]">
          on {rule.agent_id ? name(rule.agent_id) : "every host"}
          {rule.notify_email ? ` · emails ${rule.notify_email}` : ""}
        </span>
        {canEdit ? (
          <span className="ml-auto flex items-center gap-2">
            <button type="button" className="text-[12px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
              {rule.enabled ? "Pause" : "Resume"}
            </button>
            <button type="button" aria-label="Delete rule" className="text-[var(--lp-subtle)] hover:text-[#ff8fb3]" disabled={remove.isPending} onClick={() => remove.mutate()}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : null}
      </div>
      {firing ? (
        <ul className="grid gap-0.5 text-[12px] text-[var(--lp-muted)]">
          {rule.firing.map((f) => (
            <li key={f.agent_id}>
              <span className="text-[var(--lp-text)]">{name(f.agent_id)}</span> at {f.value.toFixed(0)}% since {formatDateTime(f.firing_since)}
            </li>
          ))}
        </ul>
      ) : null}
      {toggle.isError || remove.isError ? <p className="text-[12px] text-[#ff8fb3]">{((toggle.error || remove.error) as ApiError).message}</p> : null}
    </li>
  );
}

export function HostAlertsPanel({ hosts, canEdit }: { hosts: Host[]; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const rules = useQuery({ queryKey: ["host-alerts"], queryFn: () => apiRequest<HostAlertRuleList>("/api/hosts/alerts"), refetchInterval: 30_000 });
  const list = rules.data?.rules ?? [];
  const atLimit = rules.data ? rules.data.limit > 0 && list.length >= rules.data.limit : false;

  return (
    <Panel
      title="Alert rules"
      bodyClassName="p-0"
      aside={
        canEdit && !adding ? (
          <button type="button" className="console-btn console-btn-secondary h-8 px-3 text-[12px]" disabled={atLimit} title={atLimit ? "Your plan's rule limit is reached" : undefined} onClick={() => setAdding(true)}>
            Add rule
          </button>
        ) : null
      }
    >
      {adding ? <RuleForm hosts={hosts} onDone={() => setAdding(false)} /> : null}
      {rules.isError ? (
        <p className="border-t border-[var(--lp-border)] px-4 py-3 text-[13px] text-[#ff8fb3]">{(rules.error as ApiError).message}</p>
      ) : list.length ? (
        <ul className="border-t border-[var(--lp-border)]">
          {list.map((r) => (
            <RuleRow key={r.id} rule={r} hosts={hosts} canEdit={canEdit} />
          ))}
        </ul>
      ) : !adding ? (
        <p className="border-t border-[var(--lp-border)] px-4 py-5 text-[13px] text-[var(--lp-subtle)]">
          {rules.isLoading ? "Loading…" : "No rules yet. Add one to hear when a host's CPU, memory, disk, or swap stays high."}
        </p>
      ) : null}
    </Panel>
  );
}
