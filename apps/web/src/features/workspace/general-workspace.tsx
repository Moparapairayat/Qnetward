"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/api";
import type { SessionResponse, WorkspaceContextResponse } from "@/lib/types";
import { planLabel } from "@/lib/plans";
import { formatDate, Notice, roleLabel, SaveState, SettingsCard, SettingsPageTitle, WorkspaceAvatar } from "@/components/settings/settings-ui";

const NAME_MAX = 60;

function NameCard({ workspace, canEdit }: { workspace: NonNullable<WorkspaceContextResponse["workspace"]>; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? workspace.name;
  const trimmed = value.trim().replace(/\s+/g, " ");
  const changed = trimmed !== workspace.name;

  const save = useMutation({
    mutationFn: (name: string) => apiRequest<WorkspaceContextResponse>("/api/workspace", { method: "PATCH", body: JSON.stringify({ name }) }),
    onSuccess: async () => {
      setDraft(null);
      // The name shows in the sidebar, the settings menu, and the team page.
      await Promise.all(
        [["workspace-general"], ["workspace-list"], ["workspace-team"]].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });

  return (
    <SettingsCard
      id="workspace-name"
      title="Workspace name"
      description="Usually your company or team. Teammates see it in the sidebar, on invitations, and in alert emails."
      onSubmit={() => changed && trimmed && save.mutate(trimmed)}
      hint={
        <SaveState
          saved={save.isSuccess && !changed ? "Saved." : null}
          error={save.isError ? (save.error as ApiError).message : trimmed === "" && draft !== null ? "Name can't be empty." : null}
          idle={canEdit ? `Up to ${NAME_MAX} characters.` : "Only owners and admins can rename the workspace."}
        />
      }
      action={
        canEdit ? (
          <button type="submit" className="console-btn console-btn-primary" disabled={!changed || !trimmed || save.isPending}>
            {save.isPending ? "Saving" : "Save"}
          </button>
        ) : undefined
      }
    >
      <div className="flex items-center gap-3">
        <WorkspaceAvatar name={trimmed || workspace.name} id={workspace.id} size={36} />
        <input
          aria-label="Workspace name"
          className="h-9 w-full max-w-sm px-3"
          maxLength={NAME_MAX}
          disabled={!canEdit || save.isPending}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>
    </SettingsCard>
  );
}

export function WorkspaceGeneral() {
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => apiRequest<SessionResponse>("/api/auth/session") });
  const query = useQuery({
    queryKey: ["workspace-general"],
    queryFn: () => apiRequest<WorkspaceContextResponse>("/api/workspace"),
    enabled: sessionQuery.data?.authenticated === true,
  });
  const workspace = query.data?.workspace;
  const isDemo = sessionQuery.data?.mode === "demo";
  const canEdit = !isDemo && (workspace?.role === "owner" || workspace?.role === "admin");

  return (
    <div className="grid grid-cols-1 gap-5">
      <SettingsPageTitle title="General" description="The basics of this workspace." />
      {query.isError ? <Notice tone="error">{(query.error as ApiError).message || "Couldn't load the workspace."}</Notice> : null}
      {workspace ? (
        <>
          {/* Keyed by name, so a rename from elsewhere resets the draft. */}
          <NameCard key={workspace.name} workspace={workspace} canEdit={canEdit} />
          <SettingsCard id="workspace-details" title="Details">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-[140px_minmax(0,1fr)]">
              <dt className="text-[var(--lp-subtle)]">Your role</dt>
              <dd>{roleLabel(workspace.role)}</dd>
              <dt className="text-[var(--lp-subtle)]">Members</dt>
              <dd>{workspace.member_count}</dd>
              <dt className="text-[var(--lp-subtle)]">Plan</dt>
              <dd>{planLabel(workspace.plan)}</dd>
              <dt className="text-[var(--lp-subtle)]">Created</dt>
              <dd>{formatDate(workspace.created_at)}</dd>
              <dt className="text-[var(--lp-subtle)]">Workspace ID</dt>
              <dd className="lp-mono text-[12px] text-[var(--lp-muted)]">{workspace.id}</dd>
            </dl>
          </SettingsCard>
        </>
      ) : query.isLoading ? (
        <p className="text-[13px] text-[var(--lp-subtle)]">Loading…</p>
      ) : null}
    </div>
  );
}
