"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Mail } from "@/components/icons";
import { AuthInputField } from "@/components/auth/auth-input-field";
import { AuthLayoutCard } from "@/components/auth/auth-layout-card";
import { GuestOnly } from "@/components/auth/guest-only";
import { Pending, VerifyStep } from "@/components/forms/signup-form";

/**
 * Verifying an email outside signup, like after signing in to an account that
 * was never verified. It sends a fresh code on open, then takes the same six
 * boxes as signup.
 */
export function VerifyEmailFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const initial = params.get("email")?.trim() ?? "";
  const [pending, setPending] = useState<Pending | null>(initial ? { email: initial } : null);
  const [draft, setDraft] = useState(initial);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [previewCode, setPreviewCode] = useState<string | null>(null);

  return (
    <GuestOnly>
      <AuthLayoutCard
        title={pending ? "Check your inbox" : "Verify your email"}
        subtitle={
          pending ? (
            <>
              We sent a 6-digit code to <span className="text-[var(--lp-text)]">{pending.email}</span>. It works for 10 minutes.
            </>
          ) : (
            "Enter the email you signed up with and we'll send you a code."
          )
        }
        headerAction={{ prompt: "Already verified?", label: "Sign in", href: "/login" }}
      >
        {pending ? (
          <VerifyStep
            key={pending.email}
            pending={pending}
            previewCode={previewCode}
            onPreviewCode={setPreviewCode}
            sendOnMount
            onChangeEmail={() => {
              setPreviewCode(null);
              setPending(null);
            }}
            onVerified={async () => {
              await queryClient.invalidateQueries({ queryKey: ["session"] });
              router.replace("/overview");
            }}
          />
        ) : (
          <form
            className="grid gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const email = draft.trim();
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                setDraftError("Enter a valid email");
                return;
              }
              setPending({ email });
            }}
          >
            <AuthInputField
              id="verify-email"
              label="Email"
              icon={Mail}
              error={draftError ?? undefined}
              inputProps={{
                type: "email",
                autoComplete: "email",
                placeholder: "you@company.com",
                autoFocus: true,
                value: draft,
                onChange: (e) => {
                  setDraft(e.target.value);
                  setDraftError(null);
                },
              }}
            />
            <button className="auth-primary-button" type="submit">
              Send code
            </button>
          </form>
        )}
      </AuthLayoutCard>
    </GuestOnly>
  );
}
