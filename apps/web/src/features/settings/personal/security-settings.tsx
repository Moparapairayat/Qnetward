"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, KeyRound, LogOut, Monitor, Smartphone } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { AccountSession, AuditPage, AuthMessageResponse, SessionResponse } from "@/lib/types";
import { describeAuditEvent, shortUserAgent } from "@/lib/audit";
import { MFACard } from "@/features/settings/personal/mfa-card";
import { PasskeysCard } from "@/features/settings/personal/passkeys-card";
import { formatDate, Notice, SaveState, SettingsCard, SettingsPageTitle } from "@/components/settings/settings-ui";

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;
const SESSIONS_PREVIEW = 6;

function describeAgent(ua: string) {
  if (!ua) return { label: "Unknown browser", mobile: false };
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl|Go-http|node/i.test(ua) ? "API client" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return { label: os ? `${browser} on ${os}` : browser, mobile: /Android|iPhone|iPad|Mobile/.test(ua) };
}

function relative(value: string) {
  const ts = new Date(value).getTime();
  const minutes = Math.round((Date.now() - ts) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDate(value);
}

function PasswordField({ label, value, onChange, autoComplete, disabled }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; disabled: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-[var(--lp-muted)]">{label}</span>
      <span className="relative block">
        <input
          aria-label={label}
          type={show ? "text" : "password"}
          className="h-9 w-full pl-3 pr-9"
          autoComplete={autoComplete}
          maxLength={PASSWORD_MAX}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-[var(--lp-subtle)] hover:text-[var(--lp-text)]"
          onClick={() => setShow((v) => !v)}
          tabIndex={-1}
        >
          {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </span>
    </label>
  );
}

function ChangePasswordCard({ email, disabled }: { email?: string; disabled: boolean }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const change = useMutation({
    mutationFn: () =>
      apiRequest<AuthMessageResponse>("/api/account/password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) }),
    onSuccess: async () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      await queryClient.invalidateQueries({ queryKey: ["account-sessions"] });
    },
  });
  const sendReset = useMutation({
    mutationFn: () => apiRequest<AuthMessageResponse>("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  });

  const tooShort = next.length > 0 && next.length < PASSWORD_MIN;
  const mismatch = confirm.length > 0 && confirm !== next;
  const same = next.length > 0 && next === current;
  const ready = !disabled && current && next.length >= PASSWORD_MIN && confirm === next && !same && !change.isPending;
  const validation = tooShort ? `Use at least ${PASSWORD_MIN} characters.` : same ? "Pick a password you aren't using now." : mismatch ? "Passwords don't match." : null;
  const touch = (fn: (v: string) => void) => (v: string) => {
    change.reset();
    fn(v);
  };

  return (
    <SettingsCard
      id="password"
      title="Change password"
      description="Changing it signs you out everywhere except this browser."
      onSubmit={() => ready && change.mutate()}
      hint={
        <SaveState
          saved={change.isSuccess ? change.data.message : sendReset.isSuccess ? sendReset.data.message || "Check your inbox for the reset link." : null}
          error={change.isError ? (change.error as ApiError).message : sendReset.isError ? (sendReset.error as ApiError).message : validation}
          idle={
            <>
              Forgot it?{" "}
              <button type="button" className="text-[var(--lp-accent)] hover:underline disabled:opacity-50" disabled={disabled || !email || sendReset.isPending} onClick={() => sendReset.mutate()}>
                {sendReset.isPending ? "Sending…" : "Email me a reset link"}
              </button>
            </>
          }
        />
      }
      action={
        <button type="submit" className="console-btn console-btn-primary" disabled={!ready}>
          <KeyRound className="h-3.5 w-3.5" /> {change.isPending ? "Changing" : "Change password"}
        </button>
      }
    >
      <div className="grid max-w-sm gap-3">
        <PasswordField label="Current password" value={current} onChange={touch(setCurrent)} autoComplete="current-password" disabled={disabled || change.isPending} />
        <PasswordField label="New password" value={next} onChange={touch(setNext)} autoComplete="new-password" disabled={disabled || change.isPending} />
        <PasswordField label="Confirm new password" value={confirm} onChange={touch(setConfirm)} autoComplete="new-password" disabled={disabled || change.isPending} />
      </div>
    </SettingsCard>
  );
}

function SessionsCard({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessionsQuery = useQuery({
    queryKey: ["account-sessions"],
    queryFn: () => apiRequest<{ sessions: AccountSession[] }>("/api/account/sessions"),
  });
  const revoke = useMutation({
    mutationFn: (body: { id?: number; others?: boolean }) => apiRequest<AuthMessageResponse>("/api/account/sessions", { method: "DELETE", body: JSON.stringify(body) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["account-sessions"] }),
  });
  const logout = useMutation({
    mutationFn: () => apiRequest<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      router.replace("/login");
    },
  });
  const [showAll, setShowAll] = useState(false);
  const sessions = sessionsQuery.data?.sessions ?? [];
  const others = sessions.filter((s) => !s.current).length;
  // The current session first, then newest; long lists stay short until asked.
  const ordered = [...sessions].sort((a, b) => Number(b.current) - Number(a.current) || b.created_at.localeCompare(a.created_at));
  const visible = showAll ? ordered : ordered.slice(0, SESSIONS_PREVIEW);

  return (
    <SettingsCard
      id="sessions"
      title="Sessions"
      description="Browsers signed in to your account. Sessions last 30 days unless you sign them out."
      hint={
        <SaveState
          saved={revoke.isSuccess ? revoke.data.message : null}
          error={revoke.isError ? (revoke.error as ApiError).message : logout.isError ? (logout.error as ApiError).message : sessionsQuery.isError ? (sessionsQuery.error as ApiError).message : null}
          idle={sessions.length ? `${sessions.length} active ${sessions.length === 1 ? "session" : "sessions"}.` : null}
        />
      }
      action={
        <>
          {others > 0 ? (
            <button type="button" className="console-btn console-btn-secondary" disabled={disabled || revoke.isPending} onClick={() => revoke.mutate({ others: true })}>
              Sign out other sessions
            </button>
          ) : null}
          <button type="button" className="console-btn console-btn-secondary" disabled={logout.isPending} onClick={() => logout.mutate()}>
            <LogOut className="h-3.5 w-3.5" /> {logout.isPending ? "Signing out" : "Sign out here"}
          </button>
        </>
      }
    >
      {sessionsQuery.isLoading ? (
        <p className="text-sm text-[var(--lp-subtle)]">Loading sessions…</p>
      ) : (
        <ul className="divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)]">
          {visible.map((s) => {
            const agent = describeAgent(s.user_agent);
            const Icon = agent.mobile ? Smartphone : Monitor;
            return (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--lp-border-strong)] bg-white/[0.03]">
                  <Icon className="h-4 w-4 text-[var(--lp-muted)]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm">
                    {agent.label}
                    {s.current ? <span className="rounded-md border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] px-1.5 text-2xs text-[#86efac]">This browser</span> : null}
                  </p>
                  <p className="truncate text-xs text-[var(--lp-subtle)]">
                    {s.ip_address ? <span className="lp-mono">{s.ip_address}</span> : "Unknown address"} · signed in {relative(s.created_at)} · expires {formatDate(s.expires_at)}
                  </p>
                </div>
                {!s.current ? (
                  <button
                    type="button"
                    aria-label={`Sign out ${agent.label}`}
                    className="console-btn console-btn-secondary shrink-0"
                    disabled={disabled || revoke.isPending}
                    onClick={() => revoke.mutate({ id: s.id })}
                  >
                    Sign out
                  </button>
                ) : null}
              </li>
            );
          })}
          {ordered.length > SESSIONS_PREVIEW ? (
            <li className="px-4 py-2">
              <button type="button" className="-my-1.5 py-1.5 text-sm text-[var(--lp-muted)] hover:text-[var(--lp-text)]" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${ordered.length} sessions`}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </SettingsCard>
  );
}

const ACTIVITY_PREVIEW = 8;

function ActivityCard() {
  const [showAll, setShowAll] = useState(false);
  const activityQuery = useQuery({ queryKey: ["account-activity"], queryFn: () => apiRequest<AuditPage>("/api/account/activity") });
  const events = activityQuery.data?.events ?? [];
  const visible = showAll ? events : events.slice(0, ACTIVITY_PREVIEW);
  return (
    <SettingsCard
      id="activity"
      title="Recent account activity"
      description="Sign-ins, failed attempts, and password and session changes on your account. If something here wasn't you, change your password."
      hint={events.length > ACTIVITY_PREVIEW ? (
        <button type="button" className="-my-1.5 py-1.5 text-[var(--lp-muted)] hover:text-[var(--lp-text)]" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show less" : `Show all ${events.length}`}
        </button>
      ) : null}
    >
      {activityQuery.isLoading ? (
        <p className="text-sm text-[var(--lp-subtle)]">Loading…</p>
      ) : activityQuery.isError ? (
        <Notice tone="error">{(activityQuery.error as ApiError).message || "Couldn't load activity."}</Notice>
      ) : events.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--lp-border)] px-4 py-5 text-center text-sm text-[var(--lp-subtle)]">No activity recorded yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)]">
          {visible.map((event) => {
            const failed = event.action === "auth.login_failed" || event.action === "auth.mfa_failed";
            return (
              <li key={event.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className={failed ? "text-sm text-[#ff8fb3]" : "text-sm"}>{describeAuditEvent(event)}</p>
                  <p className="mt-0.5 truncate text-xs text-[var(--lp-subtle)]">
                    {[event.ip_address, shortUserAgent(event.user_agent)].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <time className="shrink-0 text-xs text-[var(--lp-subtle)]" dateTime={event.occurred_at} title={new Date(event.occurred_at).toLocaleString()}>
                  {relative(event.occurred_at)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsCard>
  );
}

export function SecuritySettings() {
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => apiRequest<SessionResponse>("/api/auth/session") });
  const session = sessionQuery.data;
  const isDemo = session?.mode === "demo";

  return (
    <div className="grid grid-cols-1 gap-5">
      <SettingsPageTitle title="Password and sessions" description="How you sign in, the second step after your password, and where you're signed in." />
      {isDemo ? <Notice tone="info">This is the shared demo account, so password and session changes are turned off.</Notice> : null}
      <ChangePasswordCard email={session?.user?.email} disabled={isDemo} />
      <PasskeysCard disabled={isDemo} />
      <MFACard disabled={isDemo} />
      <SessionsCard disabled={isDemo} />
      <ActivityCard />
    </div>
  );
}
