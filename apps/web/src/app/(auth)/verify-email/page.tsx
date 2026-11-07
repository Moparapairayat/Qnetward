import { MailCheck } from "@/components/icons";
import { AuthLayoutCard } from "@/components/auth/auth-layout-card";
import { GuestOnly } from "@/components/auth/guest-only";
import { VerifyEmailForm } from "@/components/forms/verify-email-form";

export default function VerifyEmailPage() {
  return (
    <GuestOnly>
      <AuthLayoutCard
        headerAction={{ prompt: "Wrong account?", label: "Sign in", href: "/login" }}
        icon={<MailCheck />}
        title="Check your inbox"
        subtitle="Enter the code we just emailed you to activate your account."
      >
        <VerifyEmailForm />
      </AuthLayoutCard>
    </GuestOnly>
  );
}
