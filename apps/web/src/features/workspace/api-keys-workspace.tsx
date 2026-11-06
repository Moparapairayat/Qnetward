"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus, X } from "lucide-react";
import { apiRequest, ApiError } from "@/lib/api";
import type { APIKey, APIKeyCreateResponse, APIKeyListResponse, SessionResponse, WorkspaceTeamResponse } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { formatDate, Notice, SettingsCard, SettingsPageTitle } from "@/components/settings/settings-ui";
import { Modal } from "@/components/ui/modal";
import { Stepper } from "@/components/ui/stepper";

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

type Step = 0 | 1 | 2 | 3;
const STEPS = ["Details", "Scopes", "Review", "Copy key"] as const;

function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-2.5 text-[13px]">
      <dt className="text-[var(--lp-subtle)]">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * Creating a key in four steps: name and expiry, scopes, a review of both, and
 * the token, shown once. The last step can't be dismissed by accident.
 */
function CreateKeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(0);
  const [name, setName] = useState("");
  const [days, setDays] = useState(90);
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Expiry dates only need day precision, so the time the dialog mounted will do.
  const [openedAt] = useState(() => Date.now());

  const create = useMutation({
    mutationFn: () =>
      apiRequest<APIKeyCreateResponse>("/api/workspace/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), scopes, expires_in_days: days }),
      }),
    onSuccess: async (resp) => {
      setToken(resp.token);
      setStep(3);
      await queryClient.invalidateQueries({ queryKey: ["workspace-api-keys"] });
    },
  });

  const close = () => {
    setStep(0);
    setName("");
    setDays(90);
    setScopes(["read"]);
    setToken(null);
    setCopied(false);
    create.reset();
    onClose();
  };

  const toggle = (scope: string) => setScopes((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]));
  const canContinue = step === 0 ? name.trim().length > 0 : step === 1 ? scopes.length > 0 : true;
  const expiryLabel = expiries.find((e) => e.days === days)?.label ?? `${days} days`;
  const expiryDate = days ? new Date(openedAt + days * 86_400_000) : null;

  const next = () => {
    if (!canContinue) return;
    if (step === 2) create.mutate();
    else setStep((s) => (s + 1) as Step);
  };

  const footer =
    step === 3 ? (
      <button type="button" className="console-btn console-btn-primary" onClick={close}>
        {copied ? "Done" : "I've saved the key"}
      </button>
    ) : (
      <>
        {create.isError ? <span className="mr-auto text-[12px] text-[#ff8fb3]">{(create.error as ApiError).message}</span> : null}
        {step > 0 ? (
          <button type="button" className="console-btn console-btn-secondary" disabled={create.isPending} onClick={() => setStep((s) => (s - 1) as Step)}>
            Back
          </button>
        ) : (
          <button type="button" className="console-btn console-btn-secondary" onClick={close}>
            Cancel
          </button>
        )}
        <button type="submit" form="create-key-form" className="console-btn console-btn-primary" disabled={!canContinue || create.isPending}>
          {step === 2 ? (create.isPending ? "Creating" : "Create key") : "Continue"}
        </button>
      </>
    );

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={step !== 3}
      title={step === 3 ? "Your new API key" : "Create API key"}
      description={step === 3 ? "Copy it now. For your security it won't be shown again." : "A key acts as this workspace for scripts, CI, and Terraform."}
      footer={footer}
    >
      <Stepper steps={STEPS} step={step} />
      <form
        id="create-key-form"
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        {step === 0 ? (
          <div className="grid gap-5">
            <label className="block">
              <span className="mb-1.5 block text-[13px] text-[var(--lp-muted)]">Name</span>
              <input className="h-9 w-full px-3" placeholder="GitHub Actions deploy checks" maxLength={80} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
              <span className="mt-1.5 block text-[12px] text-[var(--lp-subtle)]">Name it after what will use it, so you know what breaks if you revoke it.</span>
            </label>
            <div>
              <span className="mb-1.5 block text-[13px] text-[var(--lp-muted)]">Expiration</span>
              <div className="grid grid-cols-4 rounded-lg border border-[var(--lp-border)] p-0.5" role="radiogroup" aria-label="Expiration">
                {expiries.map((e) => (
                  <button
                    key={e.days}
                    type="button"
                    role="radio"
                    aria-checked={days === e.days}
                    onClick={() => setDays(e.days)}
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                      days === e.days ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]",
                    )}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
              <span className="mt-1.5 block text-[12px] text-[var(--lp-subtle)]">
                {expiryDate ? `Stops working on ${formatDate(expiryDate.toISOString())}.` : "Never expires. Revoke it by hand when it's no longer needed."}
              </span>
            </div>
          </div>
        ) : step === 1 ? (
          <fieldset>
            <legend className="mb-2 text-[13px] text-[var(--lp-muted)]">What can this key do? Pick only what it needs.</legend>
            <div className="grid gap-2">
              {Object.entries(scopeInfo).map(([scope, info]) => {
                const on = scopes.includes(scope);
                return (
                  <label
                    key={scope}
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-lg border px-3.5 py-3 transition-colors",
                      on ? "border-[rgba(255,61,127,0.45)] bg-[rgba(255,61,127,0.06)]" : "border-[var(--lp-border)] hover:bg-white/[0.02]",
                    )}
                  >
                    <input type="checkbox" className="mt-0.5 accent-[var(--lp-accent)]" checked={on} onChange={() => toggle(scope)} />
                    <span>
                      <span className="block text-[14px]">{info.label}</span>
                      <span className="block text-[13px] leading-snug text-[var(--lp-subtle)]">{info.detail}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {scopes.length === 0 ? <p className="mt-2 text-[12px] text-[#ff8fb3]">Choose at least one.</p> : null}
          </fieldset>
        ) : step === 2 ? (
          <div>
            <dl className="divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)] px-4">
              <ReviewRow label="Name">{name.trim()}</ReviewRow>
              <ReviewRow label="Permissions">{scopes.map((s) => scopeInfo[s]?.label ?? s).join(", ")}</ReviewRow>
              <ReviewRow label="Expiration">{expiryDate ? `${expiryLabel}, until ${formatDate(expiryDate.toISOString())}` : "Never"}</ReviewRow>
            </dl>
            <p className="mt-3 text-[12px] leading-relaxed text-[var(--lp-subtle)]">
              Creating the key is recorded in the audit log. Anyone holding it can act as this workspace within these permissions until it expires or you revoke it.
            </p>
          </div>
        ) : token ? (
          <div className="grid min-w-0 grid-cols-1 gap-3 [&>*]:min-w-0">
            <div className="flex gap-2">
              <code className="lp-mono flex h-10 min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-md border border-[var(--lp-border-strong)] bg-black/30 px-3 text-[13px]">
                {token}
              </code>
              <button
                type="button"
                className="console-btn console-btn-secondary h-10 shrink-0"
                onClick={() => {
                  void navigator.clipboard?.writeText(token).then(() => setCopied(true));
                }}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-[var(--lp-green)]" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="rounded-lg border border-[var(--lp-border)] bg-black/20 p-3">
              <p className="text-[12px] text-[var(--lp-subtle)]">Try it</p>
              <p className="lp-mono mt-1 overflow-x-auto whitespace-nowrap text-[12px] text-[var(--lp-muted)]">
                curl -H &quot;Authorization: Bearer {token.slice(0, 12)}…&quot; https://console.qnetward.com/api/monitors
              </p>
            </div>
            <Notice tone="info">Store it in your CI secrets or a password manager. If it&apos;s lost, revoke it and create a new one.</Notice>
          </div>
        ) : null}
      </form>
    </Modal>
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
  const [creating, setCreating] = useState(false);
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
        action={
          canManage ? (
            <button
              type="button"
              className="console-btn console-btn-primary"
              disabled={isDemo}
              title={isDemo ? "The shared demo account can't create keys" : undefined}
              onClick={() => setCreating(true)}
            >
              <Plus className="h-3.5 w-3.5" /> Create API key
            </button>
          ) : null
        }
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
          <CreateKeyDialog open={creating} onClose={() => setCreating(false)} />
          <SettingsCard id="keys" title="Keys" description="Only a hash of each key is stored. Revoking a key stops it immediately; every use is checked against it.">
            {keysQuery.isLoading ? (
              <p className="text-[13px] text-[var(--lp-subtle)]">Loading…</p>
            ) : keysQuery.isError ? (
              <Notice tone="error">{(keysQuery.error as ApiError).message || "Couldn't load keys."}</Notice>
            ) : keys.length === 0 ? (
              <div className="flex flex-col items-center rounded-lg border border-dashed border-[var(--lp-border)] px-6 py-10 text-center">
                <KeyRound className="h-5 w-5 text-[var(--lp-subtle)]" aria-hidden="true" />
                <p className="mt-3 text-[14px]">No API keys yet</p>
                <p className="mt-1 max-w-sm text-[13px] text-[var(--lp-subtle)]">Create one for each script or pipeline, with only the permissions it needs.</p>
                {!isDemo ? (
                  <button type="button" className="console-btn console-btn-secondary mt-4" onClick={() => setCreating(true)}>
                    <Plus className="h-3.5 w-3.5" /> Create API key
                  </button>
                ) : null}
              </div>
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
