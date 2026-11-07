"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Building2, Server, Users } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { AdminOverviewResponse, AdminUsersResponse, AdminWorkspacesResponse, RuntimeHealthResponse } from "@/lib/types";
import { PageHeader, Panel, RunStatus, StatStrip } from "@/components/tools/probe-ui";
import { Avatar } from "@/components/settings/settings-ui";
import { Pill, timeAgo } from "@/features/admin/admin-ui";

function percent(part?: number, whole?: number) {
  if (!whole || typeof part !== "number") return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

export function AdminOverviewWorkspace() {
  const overviewQuery = useQuery({ queryKey: ["admin-overview"], queryFn: () => apiRequest<AdminOverviewResponse>("/api/admin/overview") });
  const healthQuery = useQuery({ queryKey: ["runtime-health"], queryFn: () => apiRequest<RuntimeHealthResponse>("/api/healthz"), refetchInterval: 30_000 });
  const usersQuery = useQuery({ queryKey: ["admin-users"], queryFn: () => apiRequest<AdminUsersResponse>("/api/admin/users?limit=100") });
  const workspacesQuery = useQuery({ queryKey: ["admin-workspaces"], queryFn: () => apiRequest<AdminWorkspacesResponse>("/api/admin/workspaces?limit=100") });

  const o = overviewQuery.data;
  const health = healthQuery.data;
  const deps = health ? [health.database, health.redis, health.object_storage].filter((d) => d.enabled) : [];
  const degraded = health ? health.ok === false || deps.some((d) => !d.healthy) : false;
  const newestUsers = [...(usersQuery.data?.users ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
  const largest = [...(workspacesQuery.data?.workspaces ?? [])].sort((a, b) => b.member_count - a.member_count).slice(0, 5);

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="Admin overview"
        description="Everyone and everything on this Qnetward deployment: accounts, workspaces, sessions, and service health."
        status={<RunStatus tone={!health ? "idle" : degraded ? "error" : "live"} label={!health ? "Checking services" : degraded ? "Service degraded" : "All services healthy"} />}
      />

      {overviewQuery.isError ? (
        <p className="rounded-lg border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] px-3 py-2.5 text-[13px] text-[#ff8fb3]">
          {(overviewQuery.error as ApiError).message || "Couldn't load the overview."}
        </p>
      ) : null}

      <StatStrip
        items={[
          { label: "Users", value: o ? String(o.user_count) : "—" },
          { label: "Verified", value: percent(o?.verified_user_count, o?.user_count), tone: o && o.user_count && o.verified_user_count / o.user_count < 0.5 ? "warn" : undefined },
          { label: "Workspaces", value: o ? String(o.workspace_count) : "—" },
          { label: "Active sessions", value: o ? String(o.session_count) : "—" },
          { label: "Invitations", value: o ? String(o.invitation_count) : "—" },
          { label: "Pending invites", value: o ? String(o.pending_invitation_count) : "—", tone: o?.pending_invitation_count ? "warn" : undefined },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        {[
          { href: "/admin/users", icon: Users, title: "Users", body: "Accounts, verification, roles, and sessions." },
          { href: "/admin/workspaces", icon: Building2, title: "Workspaces", body: "Owners, plans, members, and invitations." },
          { href: "/admin/system", icon: Server, title: "System", body: "Dependencies and deployment settings." },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="group flex items-start gap-3 rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-4 transition-colors hover:border-[var(--lp-border-strong)] hover:bg-[#202025]"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[var(--lp-border-strong)] bg-white/[0.03]">
              <item.icon className="h-4 w-4 text-[var(--lp-muted)]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium">{item.title}</span>
              <span className="block text-[12px] text-[var(--lp-subtle)]">{item.body}</span>
            </span>
            <ArrowUpRight className="h-4 w-4 text-[var(--lp-subtle)] group-hover:text-[var(--lp-text)]" />
          </Link>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Newest accounts" aside={<Link href="/admin/users" className="text-[12px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]">View all</Link>} bodyClassName="p-0">
          {newestUsers.length ? (
            <ul className="divide-y divide-[var(--lp-border)] border-t border-[var(--lp-border)]">
              {newestUsers.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                  <Avatar name={u.name} email={u.email} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{u.name || u.email}</p>
                    <p className="truncate text-[12px] text-[var(--lp-subtle)]">{u.email}</p>
                  </div>
                  {u.email_verified_at ? null : <Pill tone="warn">Unverified</Pill>}
                  <span className="w-20 shrink-0 text-right text-[12px] text-[var(--lp-subtle)]">{timeAgo(u.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-4 text-[13px] text-[var(--lp-subtle)]">{usersQuery.isLoading ? "Loading…" : "No accounts yet."}</p>
          )}
        </Panel>

        <Panel title="Largest workspaces" aside={<Link href="/admin/workspaces" className="text-[12px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]">View all</Link>} bodyClassName="p-0">
          {largest.length ? (
            <ul className="divide-y divide-[var(--lp-border)] border-t border-[var(--lp-border)]">
              {largest.map((w) => (
                <li key={w.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{w.name}</p>
                    <p className="truncate text-[12px] text-[var(--lp-subtle)]">Owner {w.owner_name || w.owner_email}</p>
                  </div>
                  <span className="lp-mono shrink-0 text-[12px] text-[var(--lp-muted)]">
                    {w.member_count} {w.member_count === 1 ? "member" : "members"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 pb-4 text-[13px] text-[var(--lp-subtle)]">{workspacesQuery.isLoading ? "Loading…" : "No workspaces yet."}</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
