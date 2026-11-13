"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, LockKeyhole, Mail, ShieldCheck } from "@/components/icons";
import { AlternateSignIn } from "@/components/auth/alternate-sign-in";
import { AuthInputField } from "@/components/auth/auth-input-field";
import { apiRequest, ApiError } from "@/lib/api";
import type { MFAChallengeResponse, SessionResponse } from "@/lib/types";

const schema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

type FormValues = z.infer<typeof schema>;

/** The second sign-in step for accounts with two-factor sign-in on. */
function MFAStep({ token, onBack, onDone }: { token: string; onBack: () => void; onDone: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const verify = useMutation({
    mutationFn: () => apiRequest<SessionResponse>("/api/auth/mfa", { method: "POST", body: JSON.stringify({ mfa_token: token, code: code.trim() }) }),
    onSuccess: onDone,
  });
  const ready = useRecovery ? code.replace(/[-\s]/g, "").length === 10 : /^\d{6}$/.test(code.trim());

  return (
    <form
      className="grid gap-3.5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) verify.mutate();
      }}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[var(--lp-border-strong)] bg-white/[0.03]">
          <ShieldCheck className="h-4 w-4 text-[var(--lp-accent)]" aria-hidden="true" />
        </span>
        <p className="text-sm leading-relaxed text-[var(--lp-muted)]">
          {useRecovery ? "Enter one of the recovery codes you saved when you turned on two-factor sign-in. Each works once." : "Enter the 6-digit code from your authenticator app."}
        </p>
      </div>
      <AuthInputField
        key={useRecovery ? "recovery" : "totp"}
        id="login-mfa-code"
        label={useRecovery ? "Recovery code" : "Authentication code"}
        icon={KeyRound}
        inputProps={{
          autoComplete: "one-time-code",
          inputMode: useRecovery ? "text" : "numeric",
          maxLength: useRecovery ? 11 : 6,
          autoFocus: true,
          value: code,
          onChange: (e) => setCode(e.target.value),
        }}
      />
      {verify.isError ? (
        <p className="auth-notice-error" role="alert">
          {(verify.error as ApiError).message}
        </p>
      ) : null}
      <button className="auth-primary-button mt-1" type="submit" disabled={!ready || verify.isPending}>
        {verify.isPending ? "Checking…" : "Verify and sign in"}
      </button>
      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          className="auth-inline-link"
          onClick={() => {
            setUseRecovery((v) => !v);
            setCode("");
          }}
        >
          {useRecovery ? "Use your authenticator app" : "Use a recovery code"}
        </button>
        <button type="button" className="text-[var(--lp-subtle)] hover:text-[var(--lp-text)]" onClick={onBack}>
          Start over
        </button>
      </div>
    </form>
  );
}

const OAUTH_ERRORS: Record<string, string> = {
  google_unavailable: "Sign in with Google isn't set up on this server.",
  google_cancelled: "Google sign-in was cancelled.",
  google_state: "That Google sign-in expired. Try again.",
  google_unverified: "Your Google account's email isn't verified, so it can't be used here.",
  google_failed: "Google sign-in didn't work. Try again, or use your email.",
};

export function LoginForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mfaToken, setMFAToken] = useState<string | null>(null);
  const [oauthError, setOAuthError] = useState<string | null>(null);

  // Google sign-in comes back here with either an error code in the query or,
  // for accounts with two-factor sign-in, a challenge token in the fragment.
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = new URLSearchParams(url.hash.slice(1)).get("mfa");
    const error = url.searchParams.get("error");
    if (!token && !error) return;
    window.history.replaceState(null, "", url.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL once after a redirect
    if (token) setMFAToken(token);
    if (error) setOAuthError(OAUTH_ERRORS[error] ?? "Sign-in didn't work. Try again.");
  }, []);
  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    router.replace("/overview");
  };
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const login = useMutation({
    mutationFn: (values: FormValues) =>
      apiRequest<SessionResponse | MFAChallengeResponse>("/api/auth/login", { method: "POST", body: JSON.stringify(values) }),
    onSuccess: async (resp) => {
      if ("mfa_required" in resp && resp.mfa_required) {
        setMFAToken(resp.mfa_token);
        return;
      }
      await finish();
    },
    onError: (error: ApiError, values) => {
      // Right password, unverified email: finish verifying instead of failing.
      const payload = error.payload as { verification_required?: boolean; email?: string } | undefined;
      if (error.status === 403 && payload?.verification_required) {
        router.push(`/verify-email?email=${encodeURIComponent(payload.email || values.email)}`);
        return;
      }
      form.setError("root", { message: error.message });
    },
  });

  if (mfaToken) {
    return (
      <MFAStep
        token={mfaToken}
        onDone={finish}
        onBack={() => {
          setMFAToken(null);
          form.resetField("password");
        }}
      />
    );
  }

  return (
    <form className="grid gap-3.5 sm:short:gap-2.5" noValidate onSubmit={form.handleSubmit((values) => login.mutate(values))}>
      <AlternateSignIn mode="signin" />
      {oauthError ? (
        <p className="auth-notice-error" role="alert">
          {oauthError}
        </p>
      ) : null}
      <AuthInputField
        id="login-email"
        label="Email"
        icon={Mail}
        error={form.formState.errors.email?.message}
        inputProps={{
          type: "email",
          autoComplete: "email",
          ...form.register("email"),
        }}
      />
      <AuthInputField
        id="login-password"
        label="Password"
        icon={LockKeyhole}
        passwordToggle
        labelAction={
          <Link className="auth-inline-link" href="/forgot-password">
            Forgot your password?
          </Link>
        }
        error={form.formState.errors.password?.message}
        inputProps={{
          autoComplete: "current-password",
          ...form.register("password"),
        }}
      />
      {form.formState.errors.root && (
        <p className="auth-notice-error" role="alert">
          {form.formState.errors.root.message}
        </p>
      )}
      <button className="auth-primary-button mt-1" type="submit" disabled={login.isPending}>
        {login.isPending ? "Signing in…" : "Sign in"}
      </button>

    </form>
  );
}
