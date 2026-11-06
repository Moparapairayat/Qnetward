"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiRequest, ApiError } from "@/lib/api";
import type { AuthMessageResponse, SessionResponse, WorkspaceInvitationsResponse, WorkspaceListResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate, Notice, roleLabel, SettingsCard, SettingsPageTitle, WorkspaceAvatar } from "@/components/settings/settings-ui";

export function WorkspacesSettings() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => apiRequest<SessionResponse>("/api/auth/session") });
  const authenticated = sessionQuery.data?.authenticated === true;
  const isDemo = sessionQuery.data?.mode === "demo";

  const listQuery = useQuery({
    queryKey: ["workspace-list"],
    queryFn: () => apiRequest<WorkspaceListResponse>("/api/workspaces"),
    enabled: authenticated,
  });
  const invitationsQuery = useQuery({
    queryKey: ["incoming-workspace-invitations"],
    queryFn: () => apiRequest<WorkspaceInvitationsResponse>("/api/workspace/invitations"),
    enabled: authenticated,
  });

  const switchWorkspace = useMutation({
    mutationFn: (workspaceID: number) =>
      apiRequest<{ ok: boolean; message: string }>("/api/workspaces", { method: "POST", body: JSON.stringify({ workspace_id: workspaceID }) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      router.refresh();
    },
  });

  const accept = useMutation({
    mutationFn: (invitationID: number) =>
      apiRequest<AuthMessageResponse>("/api/workspace/invitations", {
        method: "POST",
        body: JSON.stringify({ invitation_id: invitationID, action: "accept" }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["incoming-workspace-invitations"] });
      await queryClient.invalidateQueries({ queryKey: ["workspace-list"] });
      await queryClient.invalidateQueries({ queryKey: ["workspace-team"] });
    },
  });

  const workspaces = listQuery.data?.workspaces ?? [];
  const activeId = listQuery.data?.active_workspace_id ?? sessionQuery.data?.active_workspace_id;
  const invitations = invitationsQuery.data?.invitations ?? [];

  return (
    <div className="grid grid-cols-1 gap-5">
      <SettingsPageTitle title="Workspaces" description="Workspaces you belong to, and invitations to join others." />

      <SettingsCard
        id="memberships"
        title="Your workspaces"
        description="Probes, history, and alert rules belong to the active workspace."
        hint={switchWorkspace.isError ? <span className="text-[#ff8fb3]">{(switchWorkspace.error as ApiError).message}</span> : null}
      >
        {workspaces.length ? (
          <ul className="divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)]">
            {workspaces.map((w) => {
              const active = w.id === activeId;
              return (
                <li key={w.id} className="flex items-center gap-3 px-4 py-3">
                  <WorkspaceAvatar name={w.name} id={w.id} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{w.name}</p>
                    <p className="text-[12px] text-[var(--lp-subtle)]">
                      {roleLabel(w.role)} · {w.member_count} {w.member_count === 1 ? "member" : "members"} · {w.plan}
                    </p>
                  </div>
                  {active ? (
                    <span className="shrink-0 rounded-md border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] px-2 py-0.5 text-[12px] text-[#86efac]">Active</span>
                  ) : (
                    <button
                      type="button"
                      className="console-btn console-btn-secondary shrink-0"
                      disabled={switchWorkspace.isPending}
                      onClick={() => switchWorkspace.mutate(w.id)}
                    >
                      {switchWorkspace.isPending && switchWorkspace.variables === w.id ? "Switching" : "Switch to"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--lp-subtle)]">{listQuery.isLoading ? "Loading…" : "You don't belong to any workspace."}</p>
        )}
      </SettingsCard>

      <SettingsCard
        id="invitations"
        title="Invitations"
        description="Workspaces that invited your email address. Joining adds them to your workspace switcher."
      >
        {invitationsQuery.isError ? (
          <Notice tone="error">{(invitationsQuery.error as ApiError).message || "Couldn't load invitations."}</Notice>
        ) : invitations.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--lp-border)] px-4 py-5 text-center text-[13px] text-[var(--lp-subtle)]">No invitations right now.</p>
        ) : (
          <ul className="divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)]">
            {invitations.map((invitation) => {
              const pending = invitation.status === "pending";
              return (
                <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px]">{invitation.workspace_name || "Workspace"}</p>
                    <p className="text-[12px] text-[var(--lp-subtle)]">
                      {roleLabel(invitation.role)} · invited by {invitation.inviter_name} · {pending ? `expires ${formatDate(invitation.expires_at)}` : invitation.status}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={cn("console-btn", pending ? "console-btn-primary" : "console-btn-secondary")}
                    disabled={isDemo || !pending || accept.isPending}
                    onClick={() => accept.mutate(invitation.id)}
                  >
                    {accept.isPending && accept.variables === invitation.id ? "Joining" : "Join workspace"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {accept.isError ? (
          <div className="mt-3">
            <Notice tone="error">{(accept.error as ApiError).message || "Couldn't join the workspace."}</Notice>
          </div>
        ) : null}
      </SettingsCard>
    </div>
  );
}
