import { UserPlus } from "@/components/icons";
import { AuthLayoutCard } from "@/components/auth/auth-layout-card";
import { DemoLoginButton } from "@/components/auth/demo-login-button";
import { GuestOnly } from "@/components/auth/guest-only";
import { SignupForm } from "@/components/forms/signup-form";

export default function SignupPage() {
  return (
    <GuestOnly>
      <AuthLayoutCard
        below={<DemoLoginButton />}
        headerAction={{ prompt: "Already have an account?", label: "Sign in", href: "/login" }}
        icon={<UserPlus />}
        title="Create your account"
        subtitle="Free during beta. Invite your team once you're in."
      >
        <SignupForm />
      </AuthLayoutCard>
    </GuestOnly>
  );
}
