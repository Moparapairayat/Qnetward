"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/api";
import type { AdminOverviewResponse, AdminUsersResponse } from "@/lib/types";
import { PageHeader, Panel, StatStrip } from "@/components/tools/probe-ui";
import { Avatar } from "@/components/settings/settings-ui";
import { HeadRow, Pill, SearchBox, Segmented, TableShell, Td, Th, timeAgo } from "@/features/admin/admin-ui";

type Filter = "all" | "admins" | "unverified" | "active";

export function AdminUsersWorkspace() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const usersQuery = useQuery({ queryKey: ["admin-users"], queryFn: () => apiRequest<AdminUsersResponse>("/api/admin/users?limit=100") });
  const overviewQuery = useQuery({ queryKey: ["admin-overview"], queryFn: () => apiRequest<AdminOverviewResponse>("/api/admin/overview") });

  const users = useMemo(() => usersQuery.data?.users ?? [], [usersQuery.data]);
  const counts = {
    all: users.length,
    admins: users.filter((u) => u.platform_role === "admin").length,
    unverified: users.filter((u) => !u.email_verified_at).length,
    active: users.filter((u) => u.active_session_count > 0).length,
  };
  const q = query.trim().toLowerCase();
  const rows = users
    .filter((u) => (filter === "admins" ? u.platform_role === "admin" : filter === "unverified" ? !u.email_verified_at : filter === "active" ? u.active_session_count > 0 : true))
    .filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const o = overviewQuery.data;

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader title="Users" description="Every account on this deployment, newest first. Showing up to 100." />

      <StatStrip
        items={[
          { label: "Accounts", value: o ? String(o.user_count) : String(users.length || "—") },
          { label: "Verified", value: o ? String(o.verified_user_count) : "—" },
          { label: "Unverified", value: String(counts.unverified), tone: counts.unverified ? "warn" : undefined },
          { label: "Signed in now", value: String(counts.active) },
          { label: "Platform admins", value: String(counts.admins) },
          { label: "Active sessions", value: o ? String(o.session_count) : "—" },
        ]}
      />

      <Panel
        title="All users"
        bodyClassName="p-0"
        aside={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Filter users"
              value={filter}
              onChange={setFilter}
              options={[
                { id: "all", label: "All", count: counts.all },
                { id: "active", label: "Signed in", count: counts.active },
                { id: "unverified", label: "Unverified", count: counts.unverified },
                { id: "admins", label: "Admins", count: counts.admins },
              ]}
            />
            <SearchBox value={query} onChange={setQuery} placeholder="Search name or email" />
          </div>
        }
      >
        {usersQuery.isError ? (
          <p className="px-4 pb-4 text-sm text-[#ff8fb3]">{(usersQuery.error as ApiError).message || "Couldn't load users."}</p>
        ) : usersQuery.isLoading ? (
          <p className="px-4 pb-4 text-sm text-[var(--lp-subtle)]">Loading users…</p>
        ) : rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-[var(--lp-subtle)]">No users match.</p>
        ) : (
          <TableShell minWidth={820}>
            <HeadRow>
              <Th>User</Th>
              <Th>Status</Th>
              <Th align="right">Workspaces</Th>
              <Th align="right">Sessions</Th>
              <Th align="right">Joined</Th>
            </HeadRow>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-[var(--lp-border)] last:border-0 hover:bg-white/[0.015]">
                  <Td>
                    <div className="flex items-center gap-3">
                      <Avatar name={u.name} email={u.email} size={28} />
                      <div className="min-w-0">
                        <p className="truncate">{u.name || "—"}</p>
                        <p className="lp-mono truncate text-xs text-[var(--lp-subtle)]">{u.email}</p>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {u.platform_role === "admin" ? <Pill tone="accent">Admin</Pill> : null}
                      {u.email_verified_at ? <Pill tone="good">Verified</Pill> : <Pill tone="warn">Unverified</Pill>}
                    </div>
                  </Td>
                  <Td align="right" className="lp-mono">
                    {u.workspace_count}
                    {u.owned_workspace_count ? <span className="text-[var(--lp-subtle)]"> · owns {u.owned_workspace_count}</span> : null}
                  </Td>
                  <Td align="right" className="lp-mono">
                    {u.active_session_count ? u.active_session_count : <span className="text-[var(--lp-subtle)]">0</span>}
                  </Td>
                  <Td align="right" className="text-[var(--lp-subtle)]">
                    <span title={new Date(u.created_at).toLocaleString()}>{timeAgo(u.created_at)}</span>
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
