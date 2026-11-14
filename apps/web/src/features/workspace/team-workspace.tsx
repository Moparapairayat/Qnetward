"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Crown, Eye, Info, Mail, MoreHorizontal, RefreshCw, Search, Trash2, UserPlus, Users, X } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { AuthMessageResponse, SessionResponse, WorkspaceInvitation, WorkspaceMember, WorkspaceTeamResponse, WorkspaceUsageResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Avatar, formatDate, Notice, roleLabel, SettingsPageTitle } from "@/components/settings/settings-ui";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_INVITES_AT_ONCE = 20;

// What each role can do. Enforced on the server: the viewer rule in
// internal/api/session.go (roleMayAct), team rules in internal/store/workspace.go,
// and owner/admin checks on keys, integrations, domains, and billing.
const ROLE_INFO: Record<string, { summary: string }> = {
  owner: { summary: "Full control, including billing and inviting other owners." },
  admin: { summary: "Manages the team, API keys, integrations, and billing." },
  member: { summary: "Runs probes and scans, and creates monitors, alerts, and status pages." },
  viewer: { summary: "Sees everything and can export it, but can't change anything." },
};

const PERMISSIONS: { label: string; roles: string[] }[] = [
  { label: "See everything and export it", roles: ["owner", "admin", "member", "viewer"] },
  { label: "Run probes and scans", roles: ["owner", "admin", "member"] },
  { label: "Create and change monitors, alerts, status pages, devices", roles: ["owner", "admin", "member"] },
  { label: "Invite and remove members and viewers", roles: ["owner", "admin"] },
  { label: "API keys, integrations, and verified domains", roles: ["owner", "admin"] },
  { label: "Buy plans and see receipts", roles: ["owner", "admin"] },
  { label: "Invite, promote, or remove admins and owners", roles: ["owner"] },
];

// Quiet badges: grey for everyone, a touch of the brand colour for owners.
const ROLE_BADGE: Record<string, string> = {
  owner: "border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] text-[#ff8fb3]",
  admin: "border-[var(--lp-border-strong)] bg-[#111111] text-[var(--lp-text)]",
  member: "border-[var(--lp-border-strong)] bg-[#111111] text-[var(--lp-muted)]",
  viewer: "border-[var(--lp-border-strong)] bg-[#111111] text-[var(--lp-muted)]",
};

const STATUS_STYLE: Record<string, string> = {
  accepted: "text-[#86efac]",
  expired: "text-[var(--lp-subtle)]",
  revoked: "text-[var(--lp-subtle)]",
};

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-xs", ROLE_BADGE[role] ?? ROLE_BADGE.member)}>
      {role === "owner" ? <Crown className="h-3 w-3" aria-hidden="true" /> : role === "viewer" ? <Eye className="h-3 w-3" aria-hidden="true" /> : null}
      {roleLabel(role)}
    </span>
  );
}

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

/** "in 6 days", "tomorrow", "today", or "expired". */
function expiresIn(iso: string) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days < 0) return "expired";
  if (days === 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  return `expires in ${days} days`;
}

/** Splits pasted text into addresses: commas, spaces, semicolons, or new lines. */
function parseEmails(text: string) {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const email = raw.trim().replace(/^<|>$/g, "");
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    (EMAIL_PATTERN.test(email) ? valid : invalid).push(email);
  }
  return { valid, invalid };
}

/** A small menu that opens from a button and closes on Escape or a click outside. */
function RowMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="console-btn h-8 w-8 px-0 text-[var(--lp-muted)] hover:bg-white/[0.06] hover:text-[var(--lp-text)]"
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-9 z-30 w-56 overflow-hidden rounded-lg border border-[var(--lp-border-strong)] bg-[#111111] py-1 shadow-[0_18px_40px_rgba(0,0,0,0.5)]">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({ children, onClick, danger, checked }: { children: ReactNode; onClick: () => void; danger?: boolean; checked?: boolean }) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
        danger ? "text-[#ff8fb3] hover:bg-[rgba(255,61,127,0.1)]" : "text-[var(--lp-text)] hover:bg-white/[0.06]",
      )}
      onClick={onClick}
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">{checked ? <Check className="h-3.5 w-3.5 text-[var(--lp-accent)]" /> : null}</span>
      {children}
    </button>
  );
}

function IconButton({ label, onClick, disabled, children, tone }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; tone?: "danger" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "console-btn h-8 w-8 px-0 text-[var(--lp-muted)]",
        tone === "danger" ? "hover:bg-[rgba(255,61,127,0.1)] hover:text-[#ff8fb3]" : "hover:bg-white/[0.06] hover:text-[var(--lp-text)]",
      )}
    >
      {children}
    </button>
  );
}

function InviteDialog({
  open,
  onClose,
  roles,
  workspaceName,
  seatsLeft,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  roles: string[];
  workspaceName: string;
  seatsLeft: number | null;
  onInvited: (summary: { tone: "success" | "error"; text: string }) => void;
}) {
  const [text, setText] = useState("");
  const [role, setRole] = useState(roles.includes("member") ? "member" : (roles[0] ?? "member"));
  const [sending, setSending] = useState(false);
  const { valid, invalid } = parseEmails(text);
  const tooMany = valid.length > MAX_INVITES_AT_ONCE || (seatsLeft !== null && valid.length > seatsLeft);

  const send = async () => {
    setSending(true);
    const failed: string[] = [];
    let sent = 0;
    let emailTrouble = false;
    for (const email of valid) {
      try {
        const res = await apiRequest<AuthMessageResponse>("/api/workspace/team", { method: "POST", body: JSON.stringify({ email, role }) });
        sent++;
        if (res.message?.includes("couldn't be sent")) emailTrouble = true;
      } catch (err) {
        failed.push(`${email}: ${(err as ApiError).message}`);
      }
    }
    setSending(false);
    setText("");
    onClose();
    const parts = [];
    if (sent) parts.push(`Invited ${sent} ${sent === 1 ? "person" : "people"} as ${roleLabel(role).toLowerCase()}.`);
    if (emailTrouble) parts.push("Some emails couldn't be sent; copy their invite links from Invitations.");
    if (failed.length) parts.push(`Not invited: ${failed.join("; ")}`);
    onInvited({ tone: failed.length && !sent ? "error" : "success", text: parts.join(" ") });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Invite people to ${workspaceName}`}
      description="They get an email with a link to join. Paste several addresses to invite them all at once."
      footer={
        <>
          <button type="button" className="console-btn console-btn-secondary h-9 px-4" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="console-btn console-btn-primary h-9 px-4" disabled={!valid.length || invalid.length > 0 || tooMany || sending} onClick={() => void send()}>
            {sending ? "Sending…" : valid.length > 1 ? `Send ${valid.length} invites` : "Send invite"}
          </button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-1.5">
          <label htmlFor="invite-emails" className="text-sm">
            Email addresses
          </label>
          <textarea
            id="invite-emails"
            rows={3}
            className="w-full resize-y px-3 py-2"
            placeholder="ana@company.com, rafi@company.com"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
          <p className="text-xs text-[var(--lp-subtle)]">
            {invalid.length ? (
              <span className="text-[#ff8fb3]">Not an email address: {invalid.slice(0, 3).join(", ")}</span>
            ) : tooMany ? (
              <span className="text-[#ff8fb3]">
                {seatsLeft !== null && valid.length > seatsLeft ? `Your plan has room for ${seatsLeft} more.` : `Up to ${MAX_INVITES_AT_ONCE} at a time.`}
              </span>
            ) : valid.length ? (
              `${valid.length} ${valid.length === 1 ? "address" : "addresses"}`
            ) : (
              "Separate addresses with commas, spaces, or new lines."
            )}
          </p>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-sm">Role</legend>
          {roles.map((r) => (
            <label
              key={r}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                role === r ? "border-[rgba(255,61,127,0.5)] bg-[rgba(255,61,127,0.06)]" : "border-[var(--lp-border)] hover:bg-white/[0.02]",
              )}
            >
              <input type="radio" name="invite-role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-1 accent-[#ff3d7f]" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{roleLabel(r)}</span>
                <span className="block text-xs leading-relaxed text-[var(--lp-subtle)]">{ROLE_INFO[r]?.summary}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </Modal>
  );
}

function RolesDialog({ open, onClose, actorRole }: { open: boolean; onClose: () => void; actorRole: string }) {
  const cols = ["owner", "admin", "member", "viewer"];
  return (
    <Modal open={open} onClose={onClose} title="What each role can do" className="max-w-[640px]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[460px] text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--lp-subtle)]">
              <th className="pb-2 font-normal">
                <span className="sr-only">Permission</span>
              </th>
              {cols.map((c) => (
                <th key={c} className={cn("pb-2 text-center font-medium", c === actorRole && "text-[var(--lp-text)]")}>
                  {roleLabel(c)}
                  {c === actorRole ? <span className="block text-2xs font-normal text-[var(--lp-accent)]">You</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p.label} className="border-t border-[var(--lp-border)]">
                <td className="py-2.5 pr-3 text-[var(--lp-muted)]">{p.label}</td>
                {cols.map((c) => (
                  <td key={c} className="py-2.5 text-center">
                    {p.roles.includes(c) ? (
                      <Check className="mx-auto h-4 w-4 text-[var(--lp-green)]" aria-label="Yes" />
                    ) : (
                      <span className="text-[var(--lp-subtle)]" aria-label="No">
                        —
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-[var(--lp-subtle)]">Every workspace keeps at least one owner.</p>
    </Modal>
  );
}

export function TeamWorkspace() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"members" | "invitations">("members");
  const [query, setQuery] = useState("");
  const [inviting, setInviting] = useState(false);
  const [showRoles, setShowRoles] = useState(false);
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => apiRequest<SessionResponse>("/api/auth/session") });
  const authenticated = sessionQuery.data?.authenticated === true;
  const teamQuery = useQuery({
    queryKey: ["workspace-team"],
    queryFn: () => apiRequest<WorkspaceTeamResponse>("/api/workspace/team"),
    enabled: authenticated,
  });
  const usageQuery = useQuery({
    queryKey: ["workspace-usage"],
    queryFn: () => apiRequest<WorkspaceUsageResponse>("/api/workspace/usage"),
    enabled: authenticated,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["workspace-team"] });
    void queryClient.invalidateQueries({ queryKey: ["workspace-usage"] });
  };
  const report = (fallback: string) => ({
    onSuccess: (data: AuthMessageResponse) => {
      setNotice({ tone: "success", text: data.message || fallback });
      refresh();
    },
    onError: (error: Error) => setNotice({ tone: "error", text: (error as ApiError).message || "Something went wrong." }),
  });

  const updateRole = useMutation({
    mutationFn: (values: { userID: number; role: string }) =>
      apiRequest<AuthMessageResponse>("/api/workspace/team", { method: "PATCH", body: JSON.stringify({ user_id: values.userID, role: values.role }) }),
    ...report("Role updated."),
  });
  const removeMember = useMutation({
    mutationFn: (userID: number) => apiRequest<AuthMessageResponse>("/api/workspace/team", { method: "DELETE", body: JSON.stringify({ user_id: userID }) }),
    ...report("Member removed."),
  });
  // Sending again replaces the invitation with a fresh one and a new email.
  const resend = useMutation({
    mutationFn: (values: { email: string; role: string }) => apiRequest<AuthMessageResponse>("/api/workspace/team", { method: "POST", body: JSON.stringify(values) }),
    ...report("Invitation sent again."),
  });
  const revoke = useMutation({
    mutationFn: (invitationID: number) =>
      apiRequest<AuthMessageResponse>("/api/workspace/team", { method: "DELETE", body: JSON.stringify({ invitation_id: invitationID }) }),
    ...report("Invitation revoked."),
  });

  const copyLink = async (invitation: WorkspaceInvitation) => {
    if (!invitation.accept_path) return;
    try {
      await navigator.clipboard.writeText(window.location.origin + invitation.accept_path);
      setCopied(invitation.id);
      window.setTimeout(() => setCopied((c) => (c === invitation.id ? null : c)), 2000);
    } catch {
      setNotice({ tone: "error", text: "Couldn't copy the link. Your browser blocked the clipboard." });
    }
  };

  const isDemo = sessionQuery.data?.mode === "demo";
  const workspace = teamQuery.data?.workspace;
  const actorRole = workspace?.role ?? "member";
  const members = teamQuery.data?.members ?? [];
  const invitations = teamQuery.data?.invitations ?? [];
  const pending = invitations.filter((i) => i.status === "pending");
  const past = invitations.filter((i) => i.status !== "pending");
  const roles = assignableRoles(actorRole);
  const inviteRoles = invitableRoles(actorRole);
  const canInvite = !isDemo && inviteRoles.length > 0;
  const q = query.trim().toLowerCase();
  const visibleMembers = q ? members.filter((m) => `${m.name} ${m.email} ${m.role}`.toLowerCase().includes(q)) : members;

  const seatLimit = usageQuery.data?.plan.limits.members ?? null;
  const seatsUsed = members.length + pending.length;
  const seatsLeft = seatLimit !== null ? Math.max(0, seatLimit - seatsUsed) : null;
  const seatShare = seatLimit ? Math.min(1, seatsUsed / seatLimit) : 0;

  return (
    <div className="grid grid-cols-1 gap-5">
      <SettingsPageTitle
        title="Team"
        description={`People in ${workspace?.name ?? "this workspace"} and what each of them can do.`}
        action={
          <>
            <button type="button" className="console-btn console-btn-secondary h-9" onClick={() => setShowRoles(true)}>
              <Info className="h-3.5 w-3.5" /> Roles
            </button>
            {canInvite ? (
              <button type="button" className="console-btn console-btn-primary h-9" onClick={() => setInviting(true)} disabled={seatsLeft === 0}>
                <UserPlus className="h-3.5 w-3.5" /> Invite people
              </button>
            ) : null}
          </>
        }
      />

      {/* Seats: members plus pending invitations, against the plan. */}
      {seatLimit !== null ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-2 text-[var(--lp-muted)]">
            <Users className="h-4 w-4" />
            <span>
              <span className="text-[var(--lp-text)]">{seatsUsed}</span> of {seatLimit.toLocaleString()} seats used
              <span className="text-[var(--lp-subtle)]"> · {usageQuery.data?.plan.name} plan</span>
            </span>
          </span>
          <span className="h-1.5 w-40 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(seatShare * 100, 3)}%`, background: seatShare >= 1 ? "#ff3d7f" : seatShare >= 0.8 ? "#fbbf24" : "#4ade80" }} />
          </span>
          {seatShare >= 0.8 ? (
            <Link href="/upgrade" className="text-sm text-[var(--lp-accent)] hover:underline">
              {seatShare >= 1 ? "No seats left · Upgrade" : "Running low · Upgrade"}
            </Link>
          ) : null}
        </div>
      ) : null}

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

      <section className="overflow-hidden rounded-xl border border-[var(--lp-border)] bg-[#0a0a0a]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--lp-border)] px-4">
          <div role="tablist" aria-label="Team" className="-mb-px flex gap-1">
            {(
              [
                ["members", "Members", members.length],
                ["invitations", "Invitations", pending.length],
              ] as const
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "flex items-center gap-2 border-b-2 px-2 py-3 text-sm transition-colors",
                  tab === id ? "border-[var(--lp-accent)] text-[var(--lp-text)]" : "border-transparent text-[var(--lp-muted)] hover:text-[var(--lp-text)]",
                )}
              >
                {label}
                <span className="rounded-full bg-white/[0.07] px-1.5 text-2xs leading-[18px] text-[var(--lp-muted)]">{count}</span>
              </button>
            ))}
          </div>
          {tab === "members" && members.length > 3 ? (
            <label className="relative my-2 block w-full sm:w-64">
              <span className="sr-only">Search members</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--lp-subtle)]" />
              <input className="h-8 w-full pl-8 pr-3" placeholder="Search name, email, or role" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          ) : null}
        </div>

        {tab === "members" ? (
          teamQuery.isLoading ? (
            <p className="px-4 py-6 text-sm text-[var(--lp-subtle)]">Loading members…</p>
          ) : visibleMembers.length ? (
            <ul className="divide-y divide-[var(--lp-border)]">
              {visibleMembers.map((member) => {
                const manageable = canManageMember(actorRole, isDemo, member);
                return (
                  <li key={member.user_id} className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={member.name} email={member.email} src={member.avatar_url || null} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm">
                        <span className="truncate font-medium">{member.name || member.email}</span>
                        {member.is_current ? <span className="shrink-0 rounded border border-[var(--lp-border)] px-1.5 text-2xs leading-4 text-[var(--lp-subtle)]">You</span> : null}
                      </p>
                      <p className="truncate text-xs text-[var(--lp-subtle)]">{member.email}</p>
                    </div>
                    <span className="hidden w-32 shrink-0 text-xs text-[var(--lp-subtle)] md:block">Joined {formatDate(member.joined_at)}</span>
                    <span className="w-24 shrink-0 text-right">
                      <RoleBadge role={member.role} />
                    </span>
                    <span className="w-8 shrink-0">
                      {manageable ? (
                        <RowMenu label={`Actions for ${member.name || member.email}`}>
                          {(close) => (
                            <>
                              <p className="px-3 pb-1 pt-1.5 text-2xs uppercase tracking-wide text-[var(--lp-subtle)]">Role</p>
                              {roles.map((r) => (
                                <MenuItem
                                  key={r}
                                  checked={member.role === r}
                                  onClick={() => {
                                    close();
                                    if (r === member.role) return;
                                    setNotice(null);
                                    updateRole.mutate({ userID: member.user_id, role: r });
                                  }}
                                >
                                  {roleLabel(r)}
                                </MenuItem>
                              ))}
                              <div className="my-1 border-t border-[var(--lp-border)]" />
                              <MenuItem
                                danger
                                onClick={() => {
                                  close();
                                  setRemoving(member);
                                }}
                              >
                                Remove from workspace
                              </MenuItem>
                            </>
                          )}
                        </RowMenu>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-6 text-sm text-[var(--lp-subtle)]">No members match “{query}”.</p>
          )
        ) : (
          <div>
            {pending.length ? (
              <ul className="divide-y divide-[var(--lp-border)]">
                {pending.map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-dashed border-[var(--lp-border-strong)] text-[var(--lp-subtle)]">
                      <Mail className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1 basis-[calc(100%-48px)] sm:basis-auto">
                      <p className="truncate text-sm">{invitation.email}</p>
                      <p className="truncate text-xs text-[var(--lp-subtle)]">
                        Invited by {invitation.inviter_name} · <span title={formatDate(invitation.expires_at)}>{expiresIn(invitation.expires_at)}</span>
                      </p>
                    </div>
                    <span className="ml-12 shrink-0 sm:ml-0 sm:w-24 sm:text-right">
                      <RoleBadge role={invitation.role} />
                    </span>
                    {canInvite ? (
                      <span className="ml-auto flex shrink-0 items-center sm:ml-0">
                        {invitation.accept_path ? (
                          <IconButton label={copied === invitation.id ? "Link copied" : `Copy the invite link for ${invitation.email}`} onClick={() => void copyLink(invitation)}>
                            {copied === invitation.id ? <Check className="h-4 w-4 text-[var(--lp-green)]" /> : <Copy className="h-4 w-4" />}
                          </IconButton>
                        ) : null}
                        <IconButton
                          label={`Send the invite to ${invitation.email} again`}
                          disabled={resend.isPending}
                          onClick={() => {
                            setNotice(null);
                            resend.mutate({ email: invitation.email, role: invitation.role });
                          }}
                        >
                          <RefreshCw className={cn("h-4 w-4", resend.isPending && resend.variables?.email === invitation.email && "animate-spin")} />
                        </IconButton>
                        <IconButton
                          label={`Revoke invite for ${invitation.email}`}
                          tone="danger"
                          disabled={revoke.isPending}
                          onClick={() => {
                            setNotice(null);
                            revoke.mutate(invitation.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-white/[0.04] text-[var(--lp-subtle)]">
                  <Mail className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm">No pending invitations</p>
                  <p className="mt-0.5 text-xs text-[var(--lp-subtle)]">People you invite show up here until they join.</p>
                </div>
                {canInvite ? (
                  <button type="button" className="console-btn console-btn-secondary h-8" onClick={() => setInviting(true)} disabled={seatsLeft === 0}>
                    <UserPlus className="h-3.5 w-3.5" /> Invite people
                  </button>
                ) : null}
              </div>
            )}
            {past.length ? (
              <div className="border-t border-[var(--lp-border)] px-4 py-3">
                <p className="mb-2 text-2xs uppercase tracking-wide text-[var(--lp-subtle)]">History</p>
                <ul className="grid gap-1.5">
                  {past.map((invitation) => (
                    <li key={invitation.id} className="flex items-center gap-3 text-xs">
                      <span className="min-w-0 flex-1 truncate text-[var(--lp-muted)]">{invitation.email}</span>
                      <span className="text-[var(--lp-subtle)]">{roleLabel(invitation.role)}</span>
                      <span className={cn("w-16 text-right capitalize", STATUS_STYLE[invitation.status] ?? STATUS_STYLE.expired)}>{invitation.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {canInvite ? (
        <InviteDialog
          key={inviting ? "open" : "closed"}
          open={inviting}
          onClose={() => setInviting(false)}
          roles={inviteRoles}
          workspaceName={workspace?.name ?? "this workspace"}
          seatsLeft={seatsLeft}
          onInvited={(summary) => {
            setNotice(summary);
            setTab("invitations");
            refresh();
          }}
        />
      ) : null}
      <RolesDialog open={showRoles} onClose={() => setShowRoles(false)} actorRole={actorRole} />
      <Modal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name || removing?.email || "member"}?`}
        className="max-w-[440px]"
        footer={
          <>
            <button type="button" className="console-btn console-btn-secondary h-9 px-4" onClick={() => setRemoving(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="console-btn h-9 bg-[#e5336f] px-4 font-medium text-white hover:bg-[#ff3d7f]"
              disabled={removeMember.isPending}
              onClick={() => {
                if (removing) removeMember.mutate(removing.user_id);
                setRemoving(null);
              }}
            >
              Remove
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-[var(--lp-muted)]">
          They lose access to {workspace?.name ?? "this workspace"} right away. Their monitors and history stay. You can invite them again later.
        </p>
      </Modal>
    </div>
  );
}
