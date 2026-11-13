"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, ShieldCheck } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { MFARecoveryResponse, MFASetupResponse, MFAStatus } from "@/lib/types";
import { formatDate, Notice, SettingsCard } from "@/components/settings/settings-ui";

type Step = "idle" | "password" | "scan" | "codes" | "manage";

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="console-btn console-btn-secondary"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true));
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[var(--lp-green)]" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = `Qnetward recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;
  return (
    <div className="grid gap-3">
      <Notice tone="success">Save these recovery codes. They are shown once, and each one signs you in once if you lose your phone.</Notice>
      <ol className="lp-mono grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-[var(--lp-border)] bg-black/20 p-4 text-sm sm:grid-cols-5">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={codes.join("\n")} label="Copy codes" />
        <a
          className="console-btn console-btn-secondary"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
          download="qnetward-recovery-codes.txt"
        >
          <Download className="h-3.5 w-3.5" /> Download
        </a>
        <button type="button" className="console-btn console-btn-primary" onClick={onDone}>
          I&apos;ve saved them
        </button>
      </div>
    </div>
  );
}

export function MFACard({ disabled }: { disabled: boolean }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["account-mfa"], queryFn: () => apiRequest<MFAStatus>("/api/account/mfa") });
  const [step, setStep] = useState<Step>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<MFASetupResponse | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [manageAction, setManageAction] = useState<"disable" | "recovery">("recovery");

  const reset = () => {
    setStep("idle");
    setPassword("");
    setCode("");
    setSetup(null);
  };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["account-mfa"] });
    void queryClient.invalidateQueries({ queryKey: ["account-activity"] });
  };

  const start = useMutation({
    mutationFn: () => apiRequest<MFASetupResponse>("/api/account/mfa/setup", { method: "POST", body: JSON.stringify({ password }) }),
    onSuccess: (resp) => {
      setSetup(resp);
      setPassword("");
      setStep("scan");
    },
  });
  const enable = useMutation({
    mutationFn: () => apiRequest<MFARecoveryResponse>("/api/account/mfa/enable", { method: "POST", body: JSON.stringify({ code: code.trim() }) }),
    onSuccess: (resp) => {
      setCodes(resp.recovery_codes);
      setCode("");
      setSetup(null);
      setStep("codes");
      refresh();
    },
  });
  const manage = useMutation({
    mutationFn: () =>
      manageAction === "disable"
        ? apiRequest("/api/account/mfa/disable", { method: "POST", body: JSON.stringify({ password, code: code.trim() }) })
        : apiRequest<MFARecoveryResponse>("/api/account/mfa/recovery-codes", { method: "POST", body: JSON.stringify({ password, code: code.trim() }) }),
    onSuccess: (resp) => {
      const next = (resp as MFARecoveryResponse | undefined)?.recovery_codes;
      reset();
      if (manageAction === "recovery" && next) {
        setCodes(next);
        setStep("codes");
      }
      refresh();
    },
  });

  const enabled = status.data?.enabled === true;
  const error = (start.error ?? enable.error ?? manage.error) as ApiError | null;

  return (
    <SettingsCard
      id="two-factor"
      title="Two-factor sign-in"
      description="Ask for a code from an authenticator app, such as Google Authenticator, 1Password, or Authy, after your password."
      hint={error ? <span className="text-[#ff8fb3]">{error.message}</span> : null}
    >
      {status.isLoading ? (
        <p className="text-sm text-[var(--lp-subtle)]">Loading…</p>
      ) : step === "codes" && codes ? (
        <RecoveryCodes
          codes={codes}
          onDone={() => {
            setCodes(null);
            setStep("idle");
          }}
        />
      ) : !enabled && step === "idle" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--lp-border)] px-4 py-3">
          <p className="text-sm text-[var(--lp-muted)]">Off. Anyone with your password can sign in.</p>
          <button type="button" className="console-btn console-btn-primary" disabled={disabled} onClick={() => setStep("password")}>
            <ShieldCheck className="h-3.5 w-3.5" /> Turn on
          </button>
        </div>
      ) : !enabled && step === "password" ? (
        <form
          className="grid gap-3 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) start.mutate();
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-xs text-[var(--lp-muted)]">Confirm your password</span>
            <input type="password" className="h-9 w-full px-3" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="console-btn console-btn-primary" disabled={!password || start.isPending}>
              {start.isPending ? "Checking" : "Continue"}
            </button>
            <button type="button" className="console-btn console-btn-secondary" onClick={reset}>
              Cancel
            </button>
          </div>
        </form>
      ) : !enabled && step === "scan" && setup ? (
        <form
          className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^\d{6}$/.test(code.trim())) enable.mutate();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the API, nothing to optimise */}
          <img src={setup.qr_code} alt="QR code to add Qnetward to your authenticator app" width={176} height={176} className="rounded-lg bg-white p-2" />
          <div className="grid min-w-0 gap-3">
            <p className="text-sm leading-relaxed text-[var(--lp-muted)]">
              Scan the code with your authenticator app. If you can&apos;t scan it, enter this key instead:
            </p>
            <div className="flex min-w-0 gap-2">
              <code className="lp-mono flex h-9 min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-md border border-[var(--lp-border-strong)] bg-black/20 px-3 text-sm tracking-wider">
                {setup.secret.match(/.{1,4}/g)?.join(" ")}
              </code>
              <CopyButton text={setup.secret} />
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs text-[var(--lp-muted)]">Then enter the 6-digit code it shows</span>
              <input
                className="lp-mono h-9 w-40 px-3 tracking-[0.3em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <div className="flex gap-2">
              <button type="submit" className="console-btn console-btn-primary" disabled={code.length !== 6 || enable.isPending}>
                {enable.isPending ? "Verifying" : "Verify and turn on"}
              </button>
              <button type="button" className="console-btn console-btn-secondary" onClick={reset}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      ) : enabled && step !== "manage" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.05)] px-4 py-3">
          <p className="text-sm">
            <span className="text-[#86efac]">On</span>
            <span className="text-[var(--lp-muted)]">
              {status.data?.enabled_at ? ` since ${formatDate(status.data.enabled_at)}` : ""} · {status.data?.recovery_codes_left ?? 0} recovery codes left
            </span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="console-btn console-btn-secondary"
              disabled={disabled}
              onClick={() => {
                setManageAction("recovery");
                setStep("manage");
              }}
            >
              New recovery codes
            </button>
            <button
              type="button"
              className="console-btn console-btn-secondary"
              disabled={disabled}
              onClick={() => {
                setManageAction("disable");
                setStep("manage");
              }}
            >
              Turn off
            </button>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-3 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (password && code) manage.mutate();
          }}
        >
          <p className="text-sm text-[var(--lp-muted)]">
            {manageAction === "disable" ? "To turn two-factor sign-in off, confirm it's you." : "New codes replace the old ones, which stop working."}
          </p>
          <label className="block">
            <span className="mb-1.5 block text-xs text-[var(--lp-muted)]">Password</span>
            <input type="password" className="h-9 w-full px-3" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-[var(--lp-muted)]">Code from your app, or a recovery code</span>
            <input className="lp-mono h-9 w-full px-3" autoComplete="one-time-code" maxLength={11} value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="console-btn console-btn-primary" disabled={!password || !code || manage.isPending}>
              {manage.isPending ? "Checking" : manageAction === "disable" ? "Turn off" : "Create new codes"}
            </button>
            <button type="button" className="console-btn console-btn-secondary" onClick={reset}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </SettingsCard>
  );
}
