import type { Metadata } from "next";
import { LockKeyhole } from "@/components/icons";
import { AuthLayoutCard } from "@/components/auth/auth-layout-card";
import { GuestOnly } from "@/components/auth/guest-only";
import { ResetPasswordForm } from "@/components/forms/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <GuestOnly>
      <AuthLayoutCard
        headerAction={{ prompt: "Remembered it?", label: "Sign in", href: "/login" }}
        icon={<LockKeyhole />}
        title="Choose a new password"
        subtitle="Pick something you haven't used here before."
      >
        <ResetPasswordForm />
      </AuthLayoutCard>
    </GuestOnly>
  );
}
