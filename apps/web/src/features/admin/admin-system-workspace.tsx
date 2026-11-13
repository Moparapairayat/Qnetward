"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, HardDrive, Mail, RefreshCw, Zap } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { AdminSystemResponse, RuntimeHealthDependency, RuntimeHealthResponse } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { DefinitionList, PageHeader, Panel, RunStatus } from "@/components/tools/probe-ui";
import { Pill } from "@/features/admin/admin-ui";

type DepRow = { key: string; name: string; purpose: string; icon: typeof Database; enabled: boolean; dep?: RuntimeHealthDependency; required?: boolean };

function depState(row: DepRow) {
  if (!row.enabled) return { label: row.required ? "Missing" : "Not configured", tone: row.required ? ("bad" as const) : ("muted" as const) };
  if (!row.dep) return { label: "Configured", tone: "good" as const };
  return row.dep.healthy ? { label: "Healthy", tone: "good" as const } : { label: "Unreachable", tone: "bad" as const };
}

export function AdminSystemWorkspace() {
  const queryClient = useQueryClient();
  const systemQuery = useQuery({ queryKey: ["admin-system"], queryFn: () => apiRequest<AdminSystemResponse>("/api/admin/system") });
  const healthQuery = useQuery({ queryKey: ["runtime-health"], queryFn: () => apiRequest<RuntimeHealthResponse>("/api/healthz"), refetchInterval: 15_000 });
  const system = systemQuery.data;
  const health = healthQuery.data;

  const rows: DepRow[] = [
    { key: "db", name: "PostgreSQL", purpose: "Accounts, workspaces, alert rules, and probe history", icon: Database, enabled: health?.database.enabled ?? true, dep: health?.database, required: true },
    { key: "redis", name: "Redis", purpose: "Caches history queries", icon: Zap, enabled: health?.redis.enabled ?? system?.runtime.redis_enabled ?? false, dep: health?.redis },
    { key: "s3", name: "Object storage", purpose: "History exports and avatar images", icon: HardDrive, enabled: health?.object_storage.enabled ?? system?.runtime.object_storage_enabled ?? false, dep: health?.object_storage },
    { key: "mail", name: "Email delivery", purpose: "Verification, password reset, invitations, and alerts", icon: Mail, enabled: system?.runtime.email_delivery_enabled ?? false },
  ];
  const failing = rows.filter((r) => depState(r).tone === "bad").length;

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="System"
        description="The services this deployment depends on, and how it's configured. Health refreshes every 15 seconds."
        status={<RunStatus tone={!health ? "idle" : failing ? "error" : "live"} label={!health ? "Checking" : failing ? `${failing} need attention` : "Operational"} />}
      />

      {systemQuery.isError ? (
        <p className="rounded-lg border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] px-3 py-2.5 text-sm text-[#ff8fb3]">
          {(systemQuery.error as ApiError).message || "Couldn't load system details."}
        </p>
      ) : null}

      <Panel
        title="Dependencies"
        bodyClassName="p-0"
        aside={
          <button
            type="button"
            aria-label="Refresh health"
            className="console-btn console-btn-secondary h-8 w-8 px-0"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["runtime-health"] })}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", healthQuery.isFetching && "animate-spin")} />
          </button>
        }
      >
        <ul className="divide-y divide-[var(--lp-border)] border-t border-[var(--lp-border)]">
          {rows.map((row) => {
            const state = depState(row);
            return (
              <li key={row.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--lp-border-strong)] bg-white/[0.03]">
                  <row.icon className="h-4 w-4 text-[var(--lp-muted)]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm">
                    {row.name}
                    {row.dep?.driver ? <span className="lp-mono text-2xs text-[var(--lp-subtle)]">{row.dep.driver}</span> : null}
                  </p>
                  <p className="text-xs text-[var(--lp-subtle)]">{row.dep?.error ? <span className="text-[#ff8fb3]">{row.dep.error}</span> : row.purpose}</p>
                </div>
                <Pill tone={state.tone}>{state.label}</Pill>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-[var(--lp-border)] px-4 py-2.5 text-xs text-[var(--lp-subtle)]">
          {health?.time ? `Last checked ${formatDateTime(health.time)}` : "Waiting for the first health check."}
        </p>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Configuration">
          <DefinitionList
            items={[
              { label: "Public base URL", value: system?.features.public_base_url || "Not set" },
              { label: "Session lifetime", value: system ? `${system.features.session_ttl_hours / 24} days` : "—" },
              { label: "Demo login", value: system ? (system.features.demo_enabled ? "On" : "Off") : "—" },
              { label: "Platform admins", value: system ? String(system.features.configured_admins) : "—" },
              { label: "Database driver", value: system?.runtime.database_driver || "—" },
            ]}
          />
        </Panel>
        <Panel title="Platform totals">
          <DefinitionList
            items={[
              { label: "Users", value: system ? `${system.overview.user_count} (${system.overview.verified_user_count} verified)` : "—" },
              { label: "Workspaces", value: system ? String(system.overview.workspace_count) : "—" },
              { label: "Active sessions", value: system ? String(system.overview.session_count) : "—" },
              { label: "Invitations", value: system ? `${system.overview.invitation_count} (${system.overview.pending_invitation_count} pending)` : "—" },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
