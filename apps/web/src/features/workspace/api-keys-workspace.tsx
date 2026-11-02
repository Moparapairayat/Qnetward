"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, X } from "lucide-react";
import { apiRequest, ApiError } from "@/lib/api";
import type { APIKey, APIKeyCreateResponse, APIKeyListResponse, SessionResponse, WorkspaceTeamResponse } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { formatDate, Notice, SettingsCard, SettingsPageTitle } from "@/components/settings/settings-ui";

const scopeInfo: Record<string, { label: string; detail: string }> = {
  read: { label: "Read", detail: "List monitors, alert rules, and history; export history" },
  write: { label: "Write", detail: "Create, change, and delete monitors and alert rules" },
  probe: { label: "Probe", detail: "Run ping, TCP ping, port scans, and DNS lookups" },
};

const expiries = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: 0, label: "Never" },
];

function relative(value?: string | null) {
  if (!value) return null;
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDate(value);
}

function keyState(key: APIKey): "active" | "revoked" | "expired" {
  if (key.revoked_at) return "revoked";
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return "expired";
  return "active";
}

function NewTokenNotice({ token, onDone }: { token: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.06)] p-4">
      <p className="text-[13px] text-[#86efac]">Copy this key now. It won&apos;t be shown again.</p>
      <div className="mt-3 flex gap-2">
        <code className="lp-mono flex h-9 min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-md border border-[var(--lp-border-strong)] bg-black/30 px-3 text-[12.5px]">
          {token}
        </code>
        <button
          type="button"
          className="console-btn console-btn-secondary h-9 shrink-0"
          onClick={() => {
            void navigator.clipboard?.writeText(token).then(() => setCopied(true));
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--lp-green)]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="lp-mono mt-3 overflow-x-auto whitespace-nowrap text-[11.5px] text-[var(--lp-subtle)]">
        curl -H &quot;Authorization: Bearer {token.slice(0, 10)}…&quot; https://console.qnetward.io/api/monitors
      </p>
      <button type="button" className="mt-3 text-[12px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]" onClick={onDone}>
        I&apos;ve saved it
      </button>
    </div>
  );
}

function CreateKeyCard({ disabled, onCreated }: { disabled: boolean; onCreated: (token: string) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [days, setDays] = useState(90);

  const create = useMutation({
    mutationFn: () =>
      apiRequest<APIKeyCreateResponse>("/api/workspace/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), scopes, expires_in_days: days }),
      }),
    onSuccess: async (resp) => {
      setName("");
      setScopes(["read"]);
      onCreated(resp.token);
      await queryClient.invalidateQueries({ queryKey: ["workspace-api-keys"] });
    },
  });

  const toggle = (scope: string) => setScopes((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]));
  const valid = name.trim().length > 0 && scopes.length > 0;

  return (
    <SettingsCard
      id="create"
      title="Create a key"
      description="Give each script or pipeline its own key with only the scopes it needs, so you can revoke one without breaking the others."
      onSubmit={valid && !disabled ? () => create.mutate() : undefined}
      hint={create.isError ? <span className="text-[#ff8fb3]">{(create.error as ApiError).message}</span> : null}
      action={
        <button type="submit" className="console-btn console-btn-primary" disabled={!valid || disabled || create.isPending}>
          <KeyRound className="h-3.5 w-3.5" /> {create.isPending ? "Creating" : "Create key"}
        </button>
      }
    >
      <div className="grid gap-4">
        <label className="block">
          <span className="mb-1.5 block text-[12px] text-[var(--lp-muted)]">Name</span>
          <input
            className="h-9 w-full px-3 sm:max-w-sm"
            placeholder="GitHub Actions deploy checks"
            maxLength={80}
            value={name}
            disabled={disabled}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <fieldset>
          <legend className="mb-1.5 text-[12px] text-[var(--lp-muted)]">Scopes</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.entries(scopeInfo).map(([scope, info]) => {
              const on = scopes.includes(scope);
              return (
                <label
                  key={scope}
                  className={cn(
                    "flex cursor-pointer gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
                    on ? "border-[rgba(255,61,127,0.45)] bg-[rgba(255,61,127,0.06)]" : "border-[var(--lp-border)] hover:bg-white/[0.02]",
                  )}
                >
                  <input type="checkbox" className="mt-0.5 accent-[var(--lp-accent)]" checked={on} disabled={disabled} onChange={() => toggle(scope)} />
                  <span>
                    <span className="block text-[13px]">{info.label}</span>
                    <span className="block text-[12px] leading-snug text-[var(--lp-subtle)]">{info.detail}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div>
          <span className="mb-1.5 block text-[12px] text-[var(--lp-muted)]">Expires</span>
          <div className="inline-flex rounded-lg border border-[var(--lp-border)] p-0.5" role="radiogroup" aria-label="Expires">
            {expiries.map((e) => (
              <button
                key={e.days}
                type="button"
                role="radio"
                aria-checked={days === e.days}
                disabled={disabled}
                onClick={() => setDays(e.days)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[12px] transition-colors",
                  days === e.days ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]",
                )}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}

function KeyRow({ apiKey, disabled }: { apiKey: APIKey; disabled: boolean }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const state = keyState(apiKey);
  const revoke = useMutation({
    mutationFn: () => apiRequest(`/api/workspace/api-keys?id=${apiKey.id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace-api-keys"] }),
  });
  const used = relative(apiKey.last_used_at);

  return (
    <li className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap", state !== "active" && "opacity-60")}>
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[var(--lp-border-strong)] bg-white/[0.03]">
        <KeyRound className="h-3.5 w-3.5 text-[var(--lp-muted)]" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-2.75rem)]">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-[13px] font-medium">{apiKey.name}</p>
          <code className="lp-mono rounded border border-[var(--lp-border)] px-1.5 text-[11.5px] text-[var(--lp-muted)]">{apiKey.prefix}…</code>
          {state !== "active" ? (
            <span className="rounded-md border border-[var(--lp-border)] px-1.5 text-[11.5px] text-[var(--lp-subtle)]">{state === "revoked" ? "Revoked" : "Expired"}</span>
          ) : null}
        </div>
        <p className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[12px] text-[var(--lp-subtle)]">
          <span>{apiKey.scopes.map((s) => scopeInfo[s]?.label ?? s).join(", ")}</span>
          <span title={formatDateTime(apiKey.created_at)}>
            Created {formatDate(apiKey.created_at)}
            {apiKey.creator_name ? ` by ${apiKey.creator_name}` : ""}
          </span>
          <span title={apiKey.last_used_at ? formatDateTime(apiKey.last_used_at) : undefined}>
            {used ? `Used ${used}${apiKey.last_used_ip ? ` from ${apiKey.last_used_ip}` : ""}` : "Never used"}
          </span>
          {state === "active" ? <span>{apiKey.expires_at ? `Expires ${formatDate(apiKey.expires_at)}` : "No expiry"}</span> : null}
        </p>
        {revoke.isError ? <p className="mt-1 text-[12px] text-[#ff8fb3]">{(revoke.error as ApiError).message}</p> : null}
      </div>
      {state === "active" && !disabled ? (
        <div className="flex shrink-0 items-center gap-1 max-sm:ml-11">
          {confirming ? (
            <>
              <button
                type="button"
                className="console-btn h-8 bg-[rgba(255,61,127,0.15)] px-2.5 text-[#ff8fb3] hover:bg-[rgba(255,61,127,0.25)]"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate()}
              >
                {revoke.isPending ? "Revoking" : "Revoke"}
              </button>
              <button type="button" className="console-btn console-btn-secondary h-8 w-8 px-0" aria-label="Keep key" onClick={() => setConfirming(false)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button type="button" className="console-btn console-btn-secondary h-8" onClick={() => setConfirming(true)}>
              Revoke
            </button>
          )}
        </div>
      ) : null}
    </li>
  );
}

export function APIKeysWorkspace() {
  const [newToken, setNewToken] = useState<string | null>(null);
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => apiRequest<SessionResponse>("/api/auth/session") });
  const teamQuery = useQuery({ queryKey: ["workspace-team"], queryFn: () => apiRequest<WorkspaceTeamResponse>("/api/workspace/team") });
  const role = teamQuery.data?.workspace?.role;
  const canManage = role === "owner" || role === "admin";
  const isDemo = sessionQuery.data?.mode === "demo";

  const keysQuery = useQuery({
    queryKey: ["workspace-api-keys"],
    queryFn: () => apiRequest<APIKeyListResponse>("/api/workspace/api-keys"),
    enabled: canManage,
  });
  const keys = keysQuery.data?.keys ?? [];
  const active = keys.filter((k) => keyState(k) === "active");
  const inactive = keys.filter((k) => keyState(k) !== "active");

  return (
    <div className="grid grid-cols-1 gap-5">
      <SettingsPageTitle
        title="API keys"
        description={
          <>
            Keys let scripts, CI, and Terraform use the API as this workspace. Send one as{" "}
            <code className="lp-mono text-[12.5px] text-[var(--lp-text)]">Authorization: Bearer qnw_…</code>. See the{" "}
            <a href="/openapi.yaml" className="text-[var(--lp-text)] underline underline-offset-4 hover:text-[var(--lp-accent)]">
              OpenAPI spec
            </a>
            .
          </>
        }
      />

      {teamQuery.isLoading ? null : !canManage ? (
        <Notice tone="info">Only workspace owners and admins can manage API keys.</Notice>
      ) : (
        <>
          {isDemo ? <Notice tone="info">The shared demo account can&apos;t create keys.</Notice> : null}
          {newToken ? <NewTokenNotice token={newToken} onDone={() => setNewToken(null)} /> : null}
          <CreateKeyCard disabled={isDemo} onCreated={setNewToken} />
          <SettingsCard id="keys" title="Keys" description="Only a hash of each key is stored. Revoking a key stops it immediately; every use is checked against it.">
            {keysQuery.isLoading ? (
              <p className="text-[13px] text-[var(--lp-subtle)]">Loading…</p>
            ) : keysQuery.isError ? (
              <Notice tone="error">{(keysQuery.error as ApiError).message || "Couldn't load keys."}</Notice>
            ) : keys.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[var(--lp-border)] px-4 py-6 text-center text-[13px] text-[var(--lp-subtle)]">No API keys yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)]">
                {[...active, ...inactive].map((k) => (
                  <KeyRow key={k.id} apiKey={k} disabled={isDemo} />
                ))}
              </ul>
            )}
          </SettingsCard>
        </>
      )}
    </div>
  );
}
