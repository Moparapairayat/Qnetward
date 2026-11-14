"use client";

import { Ref, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowUpRight, LockKeyhole, Mail } from "@/components/icons";
import { AlternateSignIn } from "@/components/auth/alternate-sign-in";
import { AuthInputField } from "@/components/auth/auth-input-field";
import { AuthLayoutCard } from "@/components/auth/auth-layout-card";
import { CodeInput } from "@/components/auth/code-input";
import { DemoLoginButton } from "@/components/auth/demo-login-button";
import { GuestOnly } from "@/components/auth/guest-only";
import { takeNext } from "@/lib/next-path";
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";
import { Stepper } from "@/components/ui/stepper";
import { apiRequest, ApiError } from "@/lib/api";
import { AuthMessageResponse, SessionResponse } from "@/lib/types";

const accountSchema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(128, "Use 128 characters or fewer"),
});

type AccountValues = z.infer<typeof accountSchema>;
type Step = 0 | 1 | 2;

const STEPS = ["Account", "Verify", "Workspace"] as const;
const RESEND_SECONDS = 60;
// Survives a refresh while the visitor fetches the code from their inbox.
const PENDING_KEY = "qnetward:signup-pending";

export type Pending = { email: string };

function readPending(): Pending | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    const value = raw ? (JSON.parse(raw) as Pending) : null;
    return value?.email ? value : null;
  } catch {
    return null;
  }
}

function writePending(value: Pending | null) {
  try {
    if (value) window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Private windows can refuse storage; the flow still works without it.
  }
}

/** A shortcut to the visitor's webmail, for the providers most people use. */
function inboxFor(email: string): { label: string; href: string } | null {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (["gmail.com", "googlemail.com"].includes(domain)) return { label: "Open Gmail", href: "https://mail.google.com/mail/u/0/#search/from%3Aqnetward" };
  if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) return { label: "Open Outlook", href: "https://outlook.live.com/mail/0/" };
  if (["yahoo.com", "ymail.com"].includes(domain)) return { label: "Open Yahoo Mail", href: "https://mail.yahoo.com/" };
  if (["icloud.com", "me.com", "mac.com"].includes(domain)) return { label: "Open iCloud Mail", href: "https://www.icloud.com/mail" };
  return null;
}

/**
 * Signup in three steps: email and password, the emailed code, then the
 * person's name and their workspace's. Asking for the name last keeps the
 * first step short. Each step titles the card, so it always says what's next.
 */
export function SignupFlow() {
  const [step, setStep] = useState<Step>(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [previewCode, setPreviewCode] = useState<string | null>(null);
  // An invitation link brings the invited address (?email=), filled in for them.
  const [invitedEmail, setInvitedEmail] = useState<string | undefined>(undefined);

  // Pick up a signup that was waiting for its code before a refresh.
  useEffect(() => {
    const email = new URLSearchParams(window.location.search).get("email")?.trim();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is only readable after mount
    if (email && email.length <= 254 && email.includes("@")) setInvitedEmail(email);
    const saved = readPending();
    if (saved) {
      setPending(saved);
      setStep(1);
    }
  }, []);

  const toVerify = (next: Pending, code: string | null) => {
    writePending(next);
    setPending(next);
    setPreviewCode(code);
    setStep(1);
  };

  const title = ["Create your account", "Check your inbox", "Set up your workspace"][step];
  const subtitle =
    step === 0 ? (
      "Free during beta. Takes about a minute."
    ) : step === 1 ? (
      <>
        We sent a 6-digit code to <span className="text-[var(--lp-text)]">{pending?.email}</span>. It works for 10 minutes.
      </>
    ) : (
      "Your email is verified. Tell us who you are and name your team's workspace."
    );

  return (
    // Verifying signs the visitor in; hold keeps the last step on screen.
    <GuestOnly hold={step === 2}>
      <AuthLayoutCard
        title={title}
        subtitle={subtitle}
        below={step === 0 ? <DemoLoginButton /> : undefined}
        headerAction={step === 0 ? { prompt: "Already have an account?", label: "Sign in", href: "/login" } : undefined}
      >
        <Stepper steps={STEPS} step={step} className="mb-5 sm:short:mb-3" />
        {step === 0 ? <AccountStep key={invitedEmail ?? "blank"} initialEmail={pending?.email ?? invitedEmail} onCreated={toVerify} /> : null}
        {step === 1 && pending ? (
          <VerifyStep
            pending={pending}
            previewCode={previewCode}
            onPreviewCode={setPreviewCode}
            onChangeEmail={() => {
              writePending(null);
              setStep(0);
            }}
            onVerified={() => {
              writePending(null);
              setStep(2);
            }}
          />
        ) : null}
        {step === 2 && pending ? <WorkspaceStep email={pending.email} /> : null}
      </AuthLayoutCard>
    </GuestOnly>
  );
}

function AccountStep({ initialEmail, onCreated }: { initialEmail?: string; onCreated: (pending: Pending, previewCode: string | null) => void }) {
  const form = useForm<AccountValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: { email: initialEmail ?? "", password: "" },
  });
  const password = useWatch({ control: form.control, name: "password" }) ?? "";
  const errors = form.formState.errors;

  const signup = useMutation({
    mutationFn: (values: AccountValues) =>
      apiRequest<AuthMessageResponse>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email: values.email, password: values.password }),
      }),
    onSuccess: (response, values) => onCreated({ email: response.email || values.email }, response.preview_code ?? null),
    onError: (error: ApiError) => form.setError("root", { message: error.message }),
  });

  return (
    <div className="grid gap-3.5 sm:short:gap-2.5">
      <AlternateSignIn mode="signup" />
      <form className="grid gap-3.5 sm:short:gap-2.5" noValidate onSubmit={form.handleSubmit((values) => signup.mutate(values))}>
        <AuthInputField
          id="signup-email"
          label="Work email"
          icon={Mail}
          error={errors.email?.message}
          inputProps={{ type: "email", autoComplete: "email", placeholder: "you@company.com", ...form.register("email") }}
        />
        <div className="grid gap-2">
          <AuthInputField
            id="signup-password"
            label="Password"
            icon={LockKeyhole}
            passwordToggle
            error={errors.password?.message}
            inputProps={{ autoComplete: "new-password", placeholder: "At least 8 characters", ...form.register("password") }}
          />
          <PasswordStrengthMeter password={password} />
        </div>

        {errors.root ? (
          <p className="auth-notice-error" role="alert">
            {errors.root.message}
          </p>
        ) : null}

        <button className="auth-primary-button mt-1" type="submit" disabled={signup.isPending}>
          {signup.isPending ? "Creating account…" : "Create account"}
        </button>
      </form>
    </div>
  );
}

/**
 * The six-box code entry, with resend and a way back to fix the email. Signup
 * uses it right after sending the code; the verify page asks for a fresh one
 * when it opens (sendOnMount), since the visitor may have lost the first.
 */
export function VerifyStep({
  pending,
  previewCode,
  onPreviewCode,
  onChangeEmail,
  onVerified,
  sendOnMount = false,
}: {
  pending: Pending;
  previewCode: string | null;
  onPreviewCode: (code: string | null) => void;
  onChangeEmail: () => void;
  onVerified: () => void;
  sendOnMount?: boolean;
}) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_SECONDS);
  const inbox = inboxFor(pending.email);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const verify = useMutation({
    mutationFn: (value: string) =>
      apiRequest<SessionResponse>("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ email: pending.email, code: value }) }),
    onSuccess: async (response) => {
      queryClient.setQueryData(["session"], { authenticated: true, user: response.user ?? null, mode: "authenticated", read_only: false });
      onVerified();
    },
    onError: (err: ApiError) => {
      setError(/invalid or expired/i.test(err.message) ? "That code didn't work. Check it, or send a new one." : err.message);
      setCode("");
    },
  });

  const resend = useMutation({
    mutationFn: () => apiRequest<AuthMessageResponse>("/api/auth/resend-verification", { method: "POST", body: JSON.stringify({ email: pending.email }) }),
    onSuccess: (response) => {
      setError(null);
      setNotice(/still active/i.test(response.message ?? "") ? "Your last code still works. Check your inbox." : "We sent a new code.");
      if (response.preview_code) onPreviewCode(response.preview_code);
      setWait(RESEND_SECONDS);
    },
    onError: (err: ApiError) => setError(err.message),
  });

  const asked = useRef(false);
  useEffect(() => {
    if (sendOnMount && !asked.current) {
      asked.current = true;
      resend.mutate();
    }
    // Once, on open; resend is a fresh object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendOnMount]);

  const submit = (value: string) => {
    setNotice(null);
    if (value.length < 6) {
      setError("Enter all 6 digits");
      return;
    }
    setError(null);
    verify.mutate(value);
  };

  return (
    <form
      className="grid gap-4 sm:short:gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit(code);
      }}
    >
      <CodeInput
        value={code}
        onChange={(v) => {
          setCode(v);
          if (error) setError(null);
        }}
        onComplete={submit}
        disabled={verify.isPending}
        invalid={Boolean(error)}
        autoFocus
      />

      {previewCode ? (
        <p className="text-xs text-[var(--lp-subtle)]">
          Email isn&apos;t set up here, so the code is <span className="lp-mono text-[var(--lp-text)]">{previewCode}</span>.
        </p>
      ) : null}
      {error ? (
        <p className="auth-notice-error" role="alert">
          {error}
        </p>
      ) : notice ? (
        <p className="auth-notice-success" role="status">
          {notice}
        </p>
      ) : null}

      <button className="auth-primary-button" type="submit" disabled={verify.isPending}>
        {verify.isPending ? "Verifying…" : "Verify email"}
      </button>

      {inbox ? (
        <a className="auth-muted-button inline-flex items-center justify-center gap-1.5" href={inbox.href} target="_blank" rel="noreferrer">
          {inbox.label} <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--lp-muted)]">
        <span>
          No code?{" "}
          {wait > 0 ? (
            <span className="text-[var(--lp-subtle)]" aria-live="off">
              Resend in 0:{String(wait).padStart(2, "0")}
            </span>
          ) : (
            <button type="button" className="auth-inline-link" disabled={resend.isPending} onClick={() => resend.mutate()}>
              {resend.isPending ? "Sending…" : "Resend code"}
            </button>
          )}
        </span>
        <button type="button" className="auth-inline-link" onClick={onChangeEmail}>
          Wrong email? Change it
        </button>
      </div>
    </form>
  );
}

function WorkspaceStep({ email }: { email: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const firstInput = useRef<HTMLInputElement | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // Follows the first name until the person types their own.
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string; workspace?: string; form?: string }>({});

  const current = useQuery({
    queryKey: ["workspace-general"],
    queryFn: () => apiRequest<{ workspace: { name: string } }>("/api/workspace"),
  });
  const workspaceName = workspace ?? (firstName.trim() ? `${firstName.trim()}'s workspace` : "");

  useEffect(() => {
    firstInput.current?.focus();
  }, []);

  const save = useMutation({
    mutationFn: async ({ name, team }: { name: string; team: string }) => {
      await apiRequest("/api/auth/profile", { method: "PATCH", body: JSON.stringify({ name, email }) });
      if (team !== current.data?.workspace.name) {
        await apiRequest("/api/workspace", { method: "PATCH", body: JSON.stringify({ name: team }) });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      router.replace(takeNext());
    },
    onError: (err: ApiError) => setErrors({ form: err.message }),
  });

  const submit = () => {
    const next = {
      firstName: firstName.trim() ? undefined : "Enter your first name",
      lastName: lastName.trim() ? undefined : "Enter your last name",
      workspace: workspaceName.trim() ? undefined : "Give your workspace a name",
    };
    if (next.firstName || next.lastName || next.workspace) {
      setErrors(next);
      return;
    }
    save.mutate({ name: `${firstName.trim()} ${lastName.trim()}`, team: workspaceName.trim() });
  };

  return (
    <form
      className="grid gap-3.5 sm:short:gap-2.5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3.5 sm:grid-cols-2 sm:short:gap-2.5">
        <PlainField
          id="signup-first-name"
          label="First name"
          value={firstName}
          error={errors.firstName}
          inputRef={firstInput}
          autoComplete="given-name"
          placeholder="Ada"
          onChange={(v) => {
            setFirstName(v);
            setErrors({});
          }}
        />
        <PlainField
          id="signup-last-name"
          label="Last name"
          value={lastName}
          error={errors.lastName}
          autoComplete="family-name"
          placeholder="Lovelace"
          onChange={(v) => {
            setLastName(v);
            setErrors({});
          }}
        />
      </div>
      <PlainField
        id="signup-workspace"
        label="Workspace name"
        value={workspaceName}
        error={errors.workspace}
        hint="Most teams use their company or team name. You can change it later."
        autoComplete="organization"
        placeholder="Acme Inc."
        onChange={(v) => {
          setWorkspace(v);
          setErrors({});
        }}
      />

      {errors.form ? (
        <p className="auth-notice-error" role="alert">
          {errors.form}
        </p>
      ) : null}

      <button className="auth-primary-button mt-1" type="submit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Continue to dashboard"}
      </button>
    </form>
  );
}

/** A labelled text field in the auth style, for state kept outside a form library. */
function PlainField({
  id,
  label,
  value,
  error,
  hint,
  inputRef,
  autoComplete,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  hint?: string;
  inputRef?: Ref<HTMLInputElement>;
  autoComplete: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="auth-input-group">
      <label className="auth-field-label" htmlFor={id}>
        {label}
      </label>
      <div className={error ? "auth-input-shell auth-input-shell-error" : "auth-input-shell"}>
        <input
          id={id}
          ref={inputRef}
          className="auth-input"
          maxLength={80}
          value={value}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {error ? (
        <p id={`${id}-error`} className="auth-field-error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-[var(--lp-subtle)]">{hint}</p>
      ) : null}
    </div>
  );
}
