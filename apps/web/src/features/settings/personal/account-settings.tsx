"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Mail } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { AuthMessageResponse, SessionResponse } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { DefinitionList } from "@/components/tools/probe-ui";
import { formatDate, Notice, SaveState, SettingsCard, SettingsPageTitle } from "@/components/settings/settings-ui";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function DeleteAccountCard({ email, disabled }: { email?: string; disabled: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const remove = useMutation({
    mutationFn: () => apiRequest<AuthMessageResponse>("/api/account", { method: "DELETE", body: JSON.stringify({ password, email: typed }) }),
    onSuccess: async () => {
      queryClient.clear();
      router.replace("/login");
    },
  });
  const matches = !!email && typed.trim().toLowerCase() === email.toLowerCase();

  return (
    <SettingsCard
      id="delete-account"
      tone="danger"
      title="Delete account"
      description="Permanently removes your account and the workspaces only you belong to, with their probe history and alert rules. What you added to other teams' workspaces stays with them. This can't be undone."
      onSubmit={open ? () => matches && password && remove.mutate() : undefined}
      hint={remove.isError ? <span className="text-[#ff8fb3]">{(remove.error as ApiError).message}</span> : "If you own a workspace with other members, transfer it or remove them first."}
      action={
        open ? (
          <>
            <button
              type="button"
              className="console-btn console-btn-secondary"
              onClick={() => {
                setOpen(false);
                setPassword("");
                setTyped("");
                remove.reset();
              }}
            >
              Cancel
            </button>
            <button type="submit" className="console-btn bg-[#e11d48] text-white hover:bg-[#f43f5e]" disabled={!matches || !password || remove.isPending}>
              {remove.isPending ? "Deleting" : "Delete my account"}
            </button>
          </>
        ) : (
          <button type="button" className="console-btn border border-[rgba(255,61,127,0.4)] text-[#ff8fb3] hover:bg-[rgba(255,61,127,0.1)]" disabled={disabled} onClick={() => setOpen(true)}>
            Delete account…
          </button>
        )
      }
    >
      {open ? (
        <div className="grid max-w-sm gap-3">
          <p className="flex items-start gap-2 text-xs leading-relaxed text-[#ff8fb3]">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> You&apos;ll be signed out and your data will be erased.
          </p>
          <label className="block">
            <span className="mb-1.5 block text-xs text-[var(--lp-muted)]">
              Type <span className="lp-mono text-[var(--lp-text)]">{email}</span> to confirm
            </span>
            <input aria-label="Confirm email" className="h-9 w-full px-3" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-[var(--lp-muted)]">Password</span>
            <input aria-label="Password" type="password" className="h-9 w-full px-3" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        </div>
      ) : null}
    </SettingsCard>
  );
}

export function AccountSettings() {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => apiRequest<SessionResponse>("/api/auth/session") });
  const session = sessionQuery.data;
  const user = session?.user;
  const isDemo = session?.mode === "demo";
  const verified = Boolean(user?.email_verified_at);
  const [draft, setDraft] = useState<string | null>(null);
  const email = draft ?? user?.email ?? "";
  const trimmed = email.trim();
  const changed = trimmed.toLowerCase() !== (user?.email ?? "").toLowerCase();
  const invalid = trimmed !== "" && !EMAIL_PATTERN.test(trimmed);

  const saveEmail = useMutation({
    mutationFn: (next: string) =>
      apiRequest<AuthMessageResponse>("/api/auth/profile", { method: "PATCH", body: JSON.stringify({ name: user?.name ?? "", email: next }) }),
    onSuccess: async (response) => {
      setDraft(null);
      if (response.user) {
        queryClient.setQueryData<SessionResponse>(["session"], (current) => ({ ...current, authenticated: true, user: response.user }));
      }
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });

  const resend = useMutation({
    mutationFn: (address: string) =>
      apiRequest<AuthMessageResponse>("/api/auth/resend-verification", { method: "POST", body: JSON.stringify({ email: address }) }),
  });

  return (
    <div className="grid grid-cols-1 gap-5">
      <SettingsPageTitle title="Account" description="The email you sign in with and the details of this account." />

      {isDemo ? <Notice tone="info">This is the shared demo account, so the email can&apos;t be changed.</Notice> : null}

      <SettingsCard
        id="email"
        title="Email address"
        description="Used to sign in, and where verification codes, password resets, and invitations go."
        onSubmit={() => changed && !invalid && trimmed && saveEmail.mutate(trimmed)}
        hint={
          <SaveState
            saved={saveEmail.isSuccess && !changed ? saveEmail.data?.message || "Saved." : null}
            error={saveEmail.isError ? (saveEmail.error as ApiError).message : invalid ? "Enter a valid email address." : null}
            idle={changed ? "We'll send a code to the new address. You stay signed in." : null}
          />
        }
        action={
          <button type="submit" className="console-btn console-btn-primary" disabled={isDemo || !changed || invalid || !trimmed || saveEmail.isPending}>
            {saveEmail.isPending ? "Saving" : "Save"}
          </button>
        }
      >
        <input
          aria-label="Email address"
          type="email"
          className="h-9 w-full max-w-sm px-3"
          autoComplete="email"
          disabled={isDemo || saveEmail.isPending}
          value={email}
          onChange={(e) => {
            saveEmail.reset();
            setDraft(e.target.value);
          }}
        />
      </SettingsCard>

      <SettingsCard
        id="verification"
        title="Verification"
        description="A verified address is required for alert emails and invitations to reach you."
        hint={
          resend.isSuccess || resend.isError ? (
            <SaveState saved={resend.isSuccess ? resend.data.message || "Code sent." : null} error={resend.isError ? (resend.error as ApiError).message : null} />
          ) : undefined
        }
        action={
          !verified && !isDemo && user?.email ? (
            <button type="button" className="console-btn console-btn-secondary" disabled={resend.isPending} onClick={() => resend.mutate(user.email)}>
              {resend.isPending ? "Sending" : "Resend code"}
            </button>
          ) : undefined
        }
      >
        <div className="flex items-center gap-3">
          <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", verified ? "bg-[rgba(74,222,128,0.12)]" : "bg-[rgba(251,191,36,0.12)]")}>
            {verified ? <Check className="h-4 w-4 text-[#4ade80]" /> : <Mail className="h-4 w-4 text-[#fbbf24]" />}
          </span>
          <div className="min-w-0">
            <p className="lp-mono truncate text-sm">{user?.email}</p>
            <p className="text-xs text-[var(--lp-subtle)]">{verified ? `Verified ${formatDateTime(user?.email_verified_at ?? "")}` : "Not verified yet"}</p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard id="details" title="Account details" description="For support requests and audit trails.">
        <DefinitionList
          items={[
            { label: "Account ID", value: user?.id ? `#${user.id}` : "—" },
            { label: "Joined", value: formatDate(user?.created_at) },
            { label: "Access", value: session?.read_only ? "Read only" : "Full" },
            { label: "Platform role", value: session?.platform_role === "admin" ? "Admin" : "User" },
          ]}
        />
      </SettingsCard>

      <DeleteAccountCard email={user?.email} disabled={isDemo} />
    </div>
  );
}
