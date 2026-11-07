"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, X } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import { createPasskey, passkeyErrorMessage, passkeysSupported, type CreationOptionsJSON } from "@/lib/webauthn";
import { formatDate, Notice, SettingsCard } from "@/components/settings/settings-ui";

type Passkey = { id: number; name: string; created_at: string; last_used_at?: string };

function defaultName() {
  if (typeof navigator === "undefined") return "Passkey";
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "This device";
  return `${os} passkey`;
}

function PasskeyRow({ passkey, disabled }: { passkey: Passkey; disabled: boolean }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: () => apiRequest(`/api/account/passkeys?id=${passkey.id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["account-passkeys"] }),
  });
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[var(--lp-border-strong)] bg-white/[0.03]">
        <Fingerprint className="h-3.5 w-3.5 text-[var(--lp-muted)]" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px]">{passkey.name}</p>
        <p className="text-[12px] text-[var(--lp-subtle)]">
          Added {formatDate(passkey.created_at)} · {passkey.last_used_at ? `last used ${formatDate(passkey.last_used_at)}` : "not used yet"}
        </p>
      </div>
      {disabled ? null : confirming ? (
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="console-btn h-8 bg-[rgba(255,61,127,0.15)] px-2.5 text-[#ff8fb3] hover:bg-[rgba(255,61,127,0.25)]" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? "Removing" : "Remove"}
          </button>
          <button type="button" className="console-btn console-btn-secondary h-8 w-8 px-0" aria-label="Keep passkey" onClick={() => setConfirming(false)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button type="button" className="console-btn console-btn-secondary h-8 shrink-0" onClick={() => setConfirming(true)}>
          Remove
        </button>
      )}
    </li>
  );
}

export function PasskeysCard({ disabled }: { disabled: boolean }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["account-passkeys"], queryFn: () => apiRequest<{ passkeys: Passkey[]; available: boolean }>("/api/account/passkeys") });
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState("");
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: async () => {
      const begin = await apiRequest<{ token: string; options: CreationOptionsJSON }>("/api/account/passkeys/begin", { method: "POST", body: JSON.stringify({ password }) });
      const credential = await createPasskey(begin.options);
      return apiRequest(`/api/account/passkeys/finish?token=${encodeURIComponent(begin.token)}&name=${encodeURIComponent(name.trim())}`, {
        method: "POST",
        body: JSON.stringify(credential),
      });
    },
    onSuccess: async () => {
      setAdding(false);
      setPassword("");
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ["account-passkeys"] });
      await queryClient.invalidateQueries({ queryKey: ["account-activity"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : passkeyErrorMessage(e)),
  });

  const passkeys = list.data?.passkeys ?? [];
  const available = list.data?.available === true;

  return (
    <SettingsCard
      id="passkeys"
      title="Passkeys"
      description="Sign in with your fingerprint, face, or device PIN instead of a password. A passkey can't be phished, and it counts as both steps of two-factor sign-in."
      hint={error ? <span className="text-[#ff8fb3]">{error}</span> : null}
    >
      {list.isLoading ? (
        <p className="text-[13px] text-[var(--lp-subtle)]">Loading…</p>
      ) : (
        <div className="grid gap-3">
          {!available ? (
            <Notice tone="info">Passkeys need the console on a domain name. Ask your administrator to set QNETWARD_PUBLIC_BASE_URL.</Notice>
          ) : null}
          {passkeys.length ? (
            <ul className="divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)]">
              {passkeys.map((p) => (
                <PasskeyRow key={p.id} passkey={p} disabled={disabled} />
              ))}
            </ul>
          ) : available ? (
            <p className="rounded-lg border border-dashed border-[var(--lp-border)] px-4 py-5 text-center text-[13px] text-[var(--lp-subtle)]">No passkeys yet.</p>
          ) : null}

          {available && !disabled ? (
            adding ? (
              <form
                className="grid gap-3 sm:max-w-sm"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!passkeysSupported()) {
                    setError("This browser can't create passkeys.");
                    return;
                  }
                  if (password && name.trim()) add.mutate();
                }}
              >
                <label className="block">
                  <span className="mb-1.5 block text-[12px] text-[var(--lp-muted)]">Name</span>
                  <input className="h-9 w-full px-3" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[12px] text-[var(--lp-muted)]">Confirm your password</span>
                  <input type="password" className="h-9 w-full px-3" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
                <div className="flex gap-2">
                  <button type="submit" className="console-btn console-btn-primary" disabled={!password || !name.trim() || add.isPending}>
                    {add.isPending ? "Waiting for your device" : "Create passkey"}
                  </button>
                  <button
                    type="button"
                    className="console-btn console-btn-secondary"
                    onClick={() => {
                      setAdding(false);
                      setError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <button type="button" className="console-btn console-btn-secondary" onClick={() => setAdding(true)}>
                  <Fingerprint className="h-3.5 w-3.5" /> Add a passkey
                </button>
              </div>
            )
          ) : null}
        </div>
      )}
    </SettingsCard>
  );
}
