import { KeyRound } from "@/components/icons";
import { AuthLayoutCard } from "@/components/auth/auth-layout-card";
import { GuestOnly } from "@/components/auth/guest-only";
import { ForgotPasswordForm } from "@/components/forms/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <GuestOnly>
      <AuthLayoutCard
        headerAction={{ prompt: "Remembered it?", label: "Sign in", href: "/login" }}
        icon={<KeyRound />}
        title="Reset your password"
        subtitle="Enter the email you signed up with and we'll send you a reset link."
      >
        <ForgotPasswordForm />
      </AuthLayoutCard>
    </GuestOnly>
  );
}
