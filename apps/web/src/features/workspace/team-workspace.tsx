"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Send, Trash2, X } from "lucide-react";
import { apiRequest, ApiError } from "@/lib/api";
import type { AuthMessageResponse, SessionResponse, WorkspaceMember, WorkspaceTeamResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar, formatDate, Notice, roleLabel, SettingsCard, SettingsPageTitle } from "@/components/settings/settings-ui";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Roles currently gate team management only (see internal/store/workspace.go); keep this in step with it.
const ROLE_HELP: { role: string; summary: string }[] = [
  { role: "owner", summary: "Invites anyone, changes or removes admins, members, and viewers." },
  { role: "admin", summary: "Invites, changes, and removes members and viewers." },
  { role: "member", summary: "Uses the workspace but can't manage the team." },
  { role: "viewer", summary: "Same access as a member for now. Read-only limits come with role-based permissions." },
];

function canManageMember(actorRole: string, isDemo: boolean, member: WorkspaceMember) {
  if (isDemo || member.is_current) return false;
  if (actorRole === "owner") return member.role !== "owner";
  if (actorRole === "admin") return member.role === "member" || member.role === "viewer";
  return false;
}

function assignableRoles(actorRole: string) {
  if (actorRole === "owner") return ["admin", "member", "viewer"];
  if (actorRole === "admin") return ["member", "viewer"];
  return [];
}

function invitableRoles(actorRole: string) {
  if (actorRole === "owner") return ["owner", "admin", "member", "viewer"];
  if (actorRole === "admin") return ["member", "viewer"];
  return [];
}

const STATUS_STYLE: Record<string, string> = {
  pending: "border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.08)] text-[#fcd34d]",
  accepted: "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]",
  expired: "border-[var(--lp-border)] bg-white/[0.03] text-[var(--lp-subtle)]",
  revoked: "border-[var(--lp-border)] bg-white/[0.03] text-[var(--lp-subtle)]",
};

function MemberRow({
  member,
  manageable,
  roles,
  busy,
  onRole,
  onRemove,
}: {
  member: WorkspaceMember;
  manageable: boolean;
  roles: string[];
  busy: boolean;
  onRole: (role: string) => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Avatar name={member.name} email={member.email} src={member.avatar_url || null} size={34} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[13px]">
          <span className="truncate">{member.name || member.email}</span>
          {member.is_current ? <span className="rounded border border-[var(--lp-border)] px-1.5 text-[11px] leading-4 text-[var(--lp-subtle)]">You</span> : null}
        </p>
        <p className="truncate text-[12px] text-[var(--lp-subtle)]">
          {member.email} · joined {formatDate(member.joined_at)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {manageable ? (
          <select
            aria-label={`Role for ${member.email}`}
            className="h-8 px-2 text-[13px]"
            disabled={busy}
            value={member.role}
            onChange={(e) => onRole(e.target.value)}
          >
            {/* An owner can't be demoted from here, so the current role is always listed. */}
            {[...new Set([member.role, ...roles])].map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
        ) : (
          <span className="px-2 text-[13px] text-[var(--lp-muted)]">{roleLabel(member.role)}</span>
        )}
        {manageable ? (
          confirming ? (
            <>
              <button
                type="button"
                className="console-btn h-8 bg-[rgba(255,61,127,0.15)] px-2.5 text-[#ff8fb3] hover:bg-[rgba(255,61,127,0.25)]"
                disabled={busy}
                onClick={onRemove}
              >
                Remove
              </button>
              <button type="button" aria-label="Keep member" className="console-btn console-btn-secondary h-8 w-8 px-0" onClick={() => setConfirming(false)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label={`Remove ${member.email}`}
              className="console-btn h-8 w-8 px-0 text-[var(--lp-muted)] hover:bg-[rgba(255,61,127,0.1)] hover:text-[#ff8fb3]"
              disabled={busy}
              onClick={() => setConfirming(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )
        ) : null}
      </div>
    </li>
  );
}

export function TeamWorkspace() {
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => apiRequest<SessionResponse>("/api/auth/session") });
  const teamQuery = useQuery({
    queryKey: ["workspace-team"],
    queryFn: () => apiRequest<WorkspaceTeamResponse>("/api/workspace/team"),
    enabled: sessionQuery.data?.authenticated === true,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["workspace-team"] });
  const report = (fallback: string) => ({
    onSuccess: async (data: AuthMessageResponse) => {
      setNotice({ tone: "success", text: data.message || fallback });
      await refresh();
    },
    onError: (error: Error) => setNotice({ tone: "error", text: (error as ApiError).message || "Something went wrong." }),
  });

  const invite = useMutation({
    mutationFn: (values: { email: string; role: string }) =>
      apiRequest<AuthMessageResponse>("/api/workspace/team", { method: "POST", body: JSON.stringify(values) }),
    ...report("Invitation sent."),
    onSuccess: async (data: AuthMessageResponse) => {
      setInviteEmail("");
      setNotice({ tone: "success", text: data.message || "Invitation sent." });
      await refresh();
    },
  });
  const updateRole = useMutation({
    mutationFn: (values: { userID: number; role: string }) =>
      apiRequest<AuthMessageResponse>("/api/workspace/team", { method: "PATCH", body: JSON.stringify({ user_id: values.userID, role: values.role }) }),
    ...report("Role updated."),
  });
  const removeMember = useMutation({
    mutationFn: (userID: number) =>
      apiRequest<AuthMessageResponse>("/api/workspace/team", { method: "DELETE", body: JSON.stringify({ user_id: userID }) }),
    ...report("Member removed."),
  });
  const revoke = useMutation({
    mutationFn: (invitationID: number) =>
      apiRequest<AuthMessageResponse>("/api/workspace/team", { method: "DELETE", body: JSON.stringify({ invitation_id: invitationID }) }),
    ...report("Invitation revoked."),
  });

  const isDemo = sessionQuery.data?.mode === "demo";
  const workspace = teamQuery.data?.workspace;
  const actorRole = workspace?.role ?? "member";
  const members = teamQuery.data?.members ?? [];
  const invitations = teamQuery.data?.invitations ?? [];
  const pending = invitations.filter((i) => i.status === "pending");
  const past = invitations.filter((i) => i.status !== "pending");
  const roles = assignableRoles(actorRole);
  const inviteRoles = invitableRoles(actorRole);
  const selectedInviteRole = inviteRoles.includes(inviteRole) ? inviteRole : (inviteRoles[0] ?? "member");
  const canInvite = !isDemo && inviteRoles.length > 0;
  const trimmedEmail = inviteEmail.trim();
  const emailInvalid = trimmedEmail !== "" && !EMAIL_PATTERN.test(trimmedEmail);
  const busy = updateRole.isPending || removeMember.isPending;
  const q = query.trim().toLowerCase();
  const visibleMembers = q ? members.filter((m) => `${m.name} ${m.email}`.toLowerCase().includes(q)) : members;
  const owners = members.filter((m) => m.role === "owner").length;

  return (
    <div className="grid grid-cols-1 gap-5">
      <SettingsPageTitle title="Team" description={`People in ${workspace?.name ?? "this workspace"} and what each of them can do.`} />

      {isDemo ? <Notice tone="info">This is the shared demo workspace, so inviting and changing members is turned off.</Notice> : null}
      {teamQuery.isError ? <Notice tone="error">{(teamQuery.error as ApiError).message || "Couldn't load the team."}</Notice> : null}
      {notice ? (
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Notice tone={notice.tone}>{notice.text}</Notice>
          </div>
          <button type="button" aria-label="Dismiss" className="mt-2 text-[var(--lp-subtle)] hover:text-[var(--lp-text)]" onClick={() => setNotice(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <SettingsCard
        id="invite"
        title="Invite people"
        description="They get an email with a link to join. Invitations expire after a few days if unused."
        onSubmit={() => {
          if (!canInvite || !trimmedEmail || emailInvalid) return;
          setNotice(null);
          invite.mutate({ email: trimmedEmail, role: selectedInviteRole });
        }}
        hint={
          emailInvalid ? (
            <span className="text-[#ff8fb3]">Enter a valid email address.</span>
          ) : canInvite ? (
            "Admins can invite members and viewers. Only owners can invite admins or owners."
          ) : isDemo ? (
            "Turned off in the demo workspace."
          ) : (
            "Only owners and admins can invite people."
          )
        }
        action={
          <button type="submit" className="console-btn console-btn-primary" disabled={!canInvite || !trimmedEmail || emailInvalid || invite.isPending}>
            <Send className="h-3.5 w-3.5" /> {invite.isPending ? "Sending" : "Send invite"}
          </button>
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            aria-label="Invite Email"
            type="email"
            placeholder="teammate@company.com"
            className="h-9 w-full min-w-0 px-3 sm:flex-1"
            disabled={!canInvite || invite.isPending}
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <select
            aria-label="Invite Role"
            className="h-9 px-2 sm:w-36"
            disabled={!canInvite || invite.isPending}
            value={selectedInviteRole}
            onChange={(e) => setInviteRole(e.target.value)}
          >
            {(inviteRoles.length ? inviteRoles : ["member"]).map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
        </div>
      </SettingsCard>

      <SettingsCard
        id="members"
        title={`Members${members.length ? ` (${members.length})` : ""}`}
        description={owners === 1 ? "Every workspace keeps at least one owner." : undefined}
      >
        {members.length > 5 ? (
          <label className="relative mb-3 block">
            <span className="sr-only">Search members</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--lp-subtle)]" />
            <input className="h-9 w-full pl-8 pr-3" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        ) : null}
        {teamQuery.isLoading ? (
          <p className="text-[13px] text-[var(--lp-subtle)]">Loading members…</p>
        ) : visibleMembers.length ? (
          <ul className="divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)]">
            {visibleMembers.map((member) => (
              <MemberRow
                key={member.user_id}
                member={member}
                manageable={canManageMember(actorRole, isDemo, member)}
                roles={roles}
                busy={busy}
                onRole={(role) => {
                  setNotice(null);
                  updateRole.mutate({ userID: member.user_id, role });
                }}
                onRemove={() => {
                  setNotice(null);
                  removeMember.mutate(member.user_id);
                }}
              />
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--lp-subtle)]">No members match “{query}”.</p>
        )}
      </SettingsCard>

      <SettingsCard id="pending" title={`Pending invitations${pending.length ? ` (${pending.length})` : ""}`} description="Invitations that haven't been accepted yet.">
        {pending.length ? (
          <ul className="divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)]">
            {pending.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="lp-mono truncate text-[13px]">{invitation.email}</p>
                  <p className="text-[12px] text-[var(--lp-subtle)]">
                    {roleLabel(invitation.role)} · invited by {invitation.inviter_name} · expires {formatDate(invitation.expires_at)}
                  </p>
                </div>
                {canInvite ? (
                  <button
                    type="button"
                    aria-label={`Revoke invite for ${invitation.email}`}
                    className="console-btn console-btn-secondary shrink-0"
                    disabled={revoke.isPending}
                    onClick={() => {
                      setNotice(null);
                      revoke.mutate(invitation.id);
                    }}
                  >
                    {revoke.isPending && revoke.variables === invitation.id ? "Revoking" : "Revoke"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--lp-border)] px-4 py-5 text-center text-[13px] text-[var(--lp-subtle)]">No pending invitations.</p>
        )}
        {past.length ? (
          <details className="mt-3 text-[13px]">
            <summary className="cursor-pointer text-[var(--lp-muted)] hover:text-[var(--lp-text)]">Past invitations ({past.length})</summary>
            <ul className="mt-2 divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)]">
              {past.map((invitation) => (
                <li key={invitation.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="lp-mono min-w-0 flex-1 truncate text-[12px]">{invitation.email}</span>
                  <span className="text-[12px] text-[var(--lp-subtle)]">{roleLabel(invitation.role)}</span>
                  <span className={cn("rounded-md border px-1.5 py-px text-[11px]", STATUS_STYLE[invitation.status] ?? STATUS_STYLE.expired)}>{invitation.status}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </SettingsCard>

      <SettingsCard id="roles" title="Roles" description="What each role can do with the team today.">
        <dl className="grid gap-px overflow-hidden rounded-lg border border-[var(--lp-border)] bg-[var(--lp-border)] sm:grid-cols-2">
          {ROLE_HELP.map((item) => (
            <div key={item.role} className={cn("bg-[#1b1b1f] px-4 py-3", item.role === actorRole && "bg-[#1f1d22]")}>
              <dt className="flex items-center gap-2 text-[13px]">
                {roleLabel(item.role)}
                {item.role === actorRole ? <span className="rounded border border-[var(--lp-border)] px-1.5 text-[11px] leading-4 text-[var(--lp-subtle)]">Your role</span> : null}
              </dt>
              <dd className="mt-0.5 text-[12px] leading-relaxed text-[var(--lp-subtle)]">{item.summary}</dd>
            </div>
          ))}
        </dl>
      </SettingsCard>
    </div>
  );
}
