"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/api";
import type { AdminWorkspacesResponse } from "@/lib/types";
import { PageHeader, Panel, StatStrip } from "@/components/tools/probe-ui";
import { WorkspaceAvatar } from "@/components/settings/settings-ui";
import { HeadRow, SearchBox, Segmented, TableShell, Td, Th, timeAgo } from "@/features/admin/admin-ui";

type Filter = "all" | "shared" | "solo" | "invites";

function planId(plan: string) {
  return plan === "pro" || plan === "enterprise" ? plan : "free";
}

/** Plan picker. Until payments exist, a platform admin sets plans by hand; each change is audited. */
function PlanSelect({ workspaceId, plan, name }: { workspaceId: number; plan: string; name: string }) {
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (next: string) =>
      apiRequest("/api/admin/workspaces/plan", { method: "POST", body: JSON.stringify({ workspace_id: workspaceId, plan: next }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-workspaces"] }),
  });
  return (
    <span className="inline-flex items-center gap-2">
      <select
        aria-label={`Plan for ${name}`}
        className="h-7 rounded-md border border-[var(--lp-border-strong)] bg-white/[0.03] px-1.5 text-[12px]"
        value={planId(plan)}
        disabled={change.isPending}
        onChange={(e) => change.mutate(e.target.value)}
      >
        <option value="free">Free</option>
        <option value="pro">Pro</option>
        <option value="enterprise">Enterprise</option>
      </select>
      {change.isError ? <span className="text-[11px] text-[#ff8fb3]" title={(change.error as ApiError).message}>Failed</span> : null}
    </span>
  );
}

export function AdminWorkspacesWorkspace() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const workspacesQuery = useQuery({ queryKey: ["admin-workspaces"], queryFn: () => apiRequest<AdminWorkspacesResponse>("/api/admin/workspaces?limit=100") });

  const workspaces = useMemo(() => workspacesQuery.data?.workspaces ?? [], [workspacesQuery.data]);
  const counts = {
    all: workspaces.length,
    shared: workspaces.filter((w) => w.member_count > 1).length,
    solo: workspaces.filter((w) => w.member_count <= 1).length,
    invites: workspaces.filter((w) => w.pending_invitation_count > 0).length,
  };
  const totalMembers = workspaces.reduce((sum, w) => sum + w.member_count, 0);
  const pendingInvites = workspaces.reduce((sum, w) => sum + w.pending_invitation_count, 0);
  const q = query.trim().toLowerCase();
  const rows = workspaces
    .filter((w) => (filter === "shared" ? w.member_count > 1 : filter === "solo" ? w.member_count <= 1 : filter === "invites" ? w.pending_invitation_count > 0 : true))
    .filter((w) => !q || `${w.name} ${w.owner_name} ${w.owner_email}`.toLowerCase().includes(q))
    .sort((a, b) => b.member_count - a.member_count || b.created_at.localeCompare(a.created_at));

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader title="Workspaces" description="Every workspace, largest first. Each one is a tenant boundary for probes, history, and alerts. Showing up to 100." />

      <StatStrip
        items={[
          { label: "Workspaces", value: String(counts.all || "—") },
          { label: "Shared", value: String(counts.shared) },
          { label: "Single member", value: String(counts.solo) },
          { label: "Memberships", value: String(totalMembers) },
          { label: "Pending invites", value: String(pendingInvites), tone: pendingInvites ? "warn" : undefined },
          { label: "Avg. members", value: counts.all ? (totalMembers / counts.all).toFixed(1) : "—" },
        ]}
      />

      <Panel
        title="All workspaces"
        bodyClassName="p-0"
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Filter workspaces"
              value={filter}
              onChange={setFilter}
              options={[
                { id: "all", label: "All", count: counts.all },
                { id: "shared", label: "Shared", count: counts.shared },
                { id: "solo", label: "Solo", count: counts.solo },
                { id: "invites", label: "With invites", count: counts.invites },
              ]}
            />
            <SearchBox value={query} onChange={setQuery} placeholder="Search name or owner" />
          </div>
        }
      >
        {workspacesQuery.isError ? (
          <p className="px-4 pb-4 text-[13px] text-[#ff8fb3]">{(workspacesQuery.error as ApiError).message || "Couldn't load workspaces."}</p>
        ) : workspacesQuery.isLoading ? (
          <p className="px-4 pb-4 text-[13px] text-[var(--lp-subtle)]">Loading workspaces…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-[var(--lp-subtle)]">No workspaces match.</p>
        ) : (
          <TableShell minWidth={860}>
            <HeadRow>
              <Th>Workspace</Th>
              <Th>Owner</Th>
              <Th>Plan</Th>
              <Th align="right">Members</Th>
              <Th align="right">Invites</Th>
              <Th align="right">Sessions</Th>
              <Th align="right">Created</Th>
            </HeadRow>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className="border-b border-[var(--lp-border)] last:border-0 hover:bg-white/[0.015]">
                  <Td>
                    <div className="flex items-center gap-3">
                      <WorkspaceAvatar name={w.name} id={w.id} size={28} />
                      <span className="truncate">{w.name}</span>
                    </div>
                  </Td>
                  <Td>
                    <p className="truncate">{w.owner_name || "—"}</p>
                    <p className="lp-mono truncate text-[12px] text-[var(--lp-subtle)]">{w.owner_email}</p>
                  </Td>
                  <Td>
                    <PlanSelect workspaceId={w.id} plan={w.plan} name={w.name} />
                  </Td>
                  <Td align="right" className="lp-mono">
                    {w.member_count}
                  </Td>
                  <Td align="right" className="lp-mono">
                    {w.pending_invitation_count ? <span className="text-[#fcd34d]">{w.pending_invitation_count}</span> : <span className="text-[var(--lp-subtle)]">0</span>}
                  </Td>
                  <Td align="right" className="lp-mono">
                    {w.active_session_count || <span className="text-[var(--lp-subtle)]">0</span>}
                  </Td>
                  <Td align="right" className="text-[var(--lp-subtle)]">
                    <span title={new Date(w.created_at).toLocaleString()}>{timeAgo(w.created_at)}</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Panel>
    </div>
  );
}
