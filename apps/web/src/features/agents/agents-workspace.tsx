"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Copy, Loader2, Plus, RadioTower, Trash2 } from "lucide-react";
import { apiRequest, ApiError } from "@/lib/api";
import type { ProbeAgent, ProbeAgentCreateResponse, ProbeAgentListResponse, SessionResponse, WorkspaceTeamResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Field, PageHeader, Panel, RunStatus, StatStrip } from "@/components/tools/probe-ui";
import { Modal } from "@/components/ui/modal";
import { Stepper } from "@/components/ui/stepper";

function ago(value?: string | null) {
  if (!value) return null;
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

type AgentState = "online" | "offline" | "waiting" | "expired";

function agentState(a: ProbeAgent): AgentState {
  if (a.enrolled) return a.online ? "online" : "offline";
  return a.enroll_expires_at && new Date(a.enroll_expires_at).getTime() < Date.now() ? "expired" : "waiting";
}

const stateStyle: Record<AgentState, { label: string; dot: string; text: string }> = {
  online: { label: "Online", dot: "#4ade80", text: "#86efac" },
  offline: { label: "Offline", dot: "#ff5c5c", text: "#ff9b9b" },
  waiting: { label: "Waiting to connect", dot: "#fbbf24", text: "#fcd34d" },
  expired: { label: "Token expired", dot: "#85858e", text: "var(--lp-subtle)" },
};

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 gap-2">
      <code className="lp-mono min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-md border border-[var(--lp-border-strong)] bg-black/30 px-3 py-2.5 text-[12px] leading-relaxed">{text}</code>
      <button
        type="button"
        className="console-btn console-btn-secondary shrink-0 self-start"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-[var(--lp-green)]" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const STEPS = ["Name", "Install", "Connect"] as const;

/** Name the agent, run one command on the machine, and watch it check in. */
function AddAgentDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<ProbeAgentCreateResponse | null>(null);
  const create = useMutation({
    mutationFn: () => apiRequest<ProbeAgentCreateResponse>("/api/agents", { method: "POST", body: JSON.stringify({ name: name.trim() }) }),
    onSuccess: async (resp) => {
      setCreated(resp);
      await queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
  // Shares the page's cache, which live events refresh when the agent enrolls.
  const agents = useQuery({
    queryKey: ["agents"],
    queryFn: () => apiRequest<ProbeAgentListResponse>("/api/agents"),
    enabled: created !== null,
    refetchInterval: 5_000,
  });
  const live = created ? agents.data?.agents.find((a) => a.id === created.agent.id) : undefined;
  const connected = Boolean(live?.enrolled);
  const step = !created ? 0 : connected ? 2 : 1;
  const server = typeof window === "undefined" ? "" : window.location.origin;
  const command = created ? `qnetward agent \\\n  --server ${server} \\\n  --token ${created.enroll_token}` : "";

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a probe agent"
      description="An agent runs checks from a machine you choose, including ones inside a private network. It only makes outbound HTTPS connections."
      footer={
        !created ? (
          <>
            {create.isError ? <span className="mr-auto text-[12px] text-[#ff8fb3]">{(create.error as ApiError).message}</span> : null}
            <button type="button" className="console-btn console-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" form="agent-form" className="console-btn console-btn-primary" disabled={!name.trim() || create.isPending}>
              {create.isPending ? "Creating" : "Continue"}
            </button>
          </>
        ) : (
          <button type="button" className={cn("console-btn", connected ? "console-btn-primary" : "console-btn-secondary")} onClick={onClose}>
            {connected ? "Done" : "Close, I'll finish later"}
          </button>
        )
      }
    >
      <Stepper steps={STEPS} step={step} />
      {!created ? (
        <form
          id="agent-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Field label="Name" hint="Where it runs, so alerts make sense: “Dhaka office”, “AWS Singapore”, “Data center rack 4”.">
            <input className="h-9 w-full px-3" maxLength={60} autoFocus placeholder="Dhaka office" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </form>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 [&>*]:min-w-0">
          <div>
            <p className="mb-2 text-[13px] text-[var(--lp-muted)]">Run this on the machine. The token works once and expires in an hour.</p>
            <CopyBlock text={command} />
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--lp-subtle)]">
              Run it as root, or give the binary <code className="lp-mono">CAP_NET_RAW</code>, so ping and traceroute work. After this first run the agent remembers its
              credentials; start it again with just <code className="lp-mono">qnetward agent</code>.
            </p>
          </div>
          <div
            className={cn(
              "flex items-center gap-3 rounded-lg border px-4 py-3 text-[13px]",
              connected ? "border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.08)] text-[#86efac]" : "border-[var(--lp-border)] bg-white/[0.02] text-[var(--lp-muted)]",
            )}
            role="status"
          >
            {connected ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
            {connected ? `Connected from ${live?.hostname || "the machine"}${live?.version ? `, agent ${live.version}` : ""}.` : "Waiting for the agent to connect…"}
          </div>
        </div>
      )}
    </Modal>
  );
}

function AgentRow({ agent, canManage }: { agent: ProbeAgent; canManage: boolean }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => apiRequest(`/api/agents?id=${agent.id}`, { method: "DELETE" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
  });
  const state = agentState(agent);
  const style = stateStyle[state];
  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: style.dot, boxShadow: state === "online" ? `0 0 0 3px ${style.dot}22` : undefined }} />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 text-[14px] font-medium">
            <span className="truncate">{agent.name}</span>
            <span className="text-[12px] font-normal" style={{ color: style.text }}>
              {style.label}
            </span>
          </p>
          <p className="mt-0.5 truncate text-[12px] text-[var(--lp-subtle)]">
            {agent.enrolled
              ? [agent.hostname, agent.platform, agent.version && `v${agent.version}`, agent.remote_ip].filter(Boolean).join(" · ")
              : state === "expired"
                ? "Never connected. Remove it and add the agent again for a fresh token."
                : "Created, not connected yet."}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 pl-5 sm:pl-0">
        {agent.last_seen_at ? <span className="text-[12px] text-[var(--lp-subtle)]">Seen {ago(agent.last_seen_at)}</span> : null}
        {canManage ? (
          <button
            type="button"
            className="console-btn console-btn-secondary h-8 w-8 px-0 hover:text-[#ff8fb3]"
            aria-label={`Remove ${agent.name}`}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Remove ${agent.name}? It stops working immediately, and the machine has to enroll again to come back.`)) remove.mutate();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function AgentsWorkspace() {
  const [adding, setAdding] = useState(false);
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => apiRequest<SessionResponse>("/api/auth/session") });
  const enabled = sessionQuery.data?.authenticated === true;
  const teamQuery = useQuery({ queryKey: ["workspace-team"], queryFn: () => apiRequest<WorkspaceTeamResponse>("/api/workspace/team"), enabled });
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: () => apiRequest<ProbeAgentListResponse>("/api/agents"), enabled, refetchInterval: 30_000 });

  const role = teamQuery.data?.workspace?.role;
  const isDemo = sessionQuery.data?.mode === "demo";
  const canManage = (role === "owner" || role === "admin") && !isDemo;
  const agents = agentsQuery.data?.agents ?? [];
  const limit = agentsQuery.data?.limit ?? 0;
  const online = agents.filter((a) => a.enrolled && a.online).length;
  const offline = agents.filter((a) => a.enrolled && !a.online).length;
  const atLimit = limit > 0 && agents.length >= limit;

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          title="Probe agents"
          description="Agents run checks from machines you choose: inside an office or data center to reach private addresses, or in other regions to see what users there see. They connect out over HTTPS; nothing needs to reach them."
          status={agents.length ? <RunStatus tone={offline ? "error" : "live"} label={offline ? `${offline} offline` : `${online} online`} /> : null}
        />
        {canManage ? (
          <button type="button" className="console-btn console-btn-primary shrink-0" disabled={atLimit} title={atLimit ? `Your plan includes ${limit} agents` : undefined} onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Add agent
          </button>
        ) : null}
      </div>

      {adding ? <AddAgentDialog onClose={() => setAdding(false)} /> : null}

      {agents.length ? (
        <StatStrip
          items={[
            { label: "Agents", value: limit ? `${agents.length} / ${limit}` : String(agents.length) },
            { label: "Online", value: String(online), tone: online ? "good" : undefined },
            { label: "Offline", value: String(offline), tone: offline ? "bad" : undefined },
            { label: "Not connected", value: String(agents.filter((a) => !a.enrolled).length) },
          ]}
        />
      ) : null}

      {agentsQuery.isLoading ? (
        <p className="text-[13px] text-[var(--lp-subtle)]">Loading…</p>
      ) : agentsQuery.isError ? (
        <p className="text-[13px] text-[#ff8fb3]">{(agentsQuery.error as ApiError).message}</p>
      ) : agents.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <RadioTower className="h-6 w-6 text-[var(--lp-subtle)]" aria-hidden="true" />
            <p className="mt-3 text-[15px] font-medium">No agents yet</p>
            <p className="mt-1 max-w-md text-[13px] text-[var(--lp-subtle)]">
              Install one on a server, VM, or Raspberry Pi in the network you want to watch. Running checks through agents arrives next; for now agents connect and
              report their health.
            </p>
            {canManage ? (
              <button type="button" className="console-btn console-btn-primary mt-5" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5" /> Add your first agent
              </button>
            ) : null}
          </div>
        </Panel>
      ) : (
        <Panel bodyClassName="p-0">
          <ul className="divide-y divide-[var(--lp-border)]">
            {agents.map((a) => (
              <AgentRow key={a.id} agent={a} canManage={canManage} />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
