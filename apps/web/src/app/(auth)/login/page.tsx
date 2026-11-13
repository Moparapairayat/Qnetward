import type { Metadata } from "next";
import { LogIn } from "@/components/icons";
import { AuthLayoutCard } from "@/components/auth/auth-layout-card";
import { DemoLoginButton } from "@/components/auth/demo-login-button";
import { GuestOnly } from "@/components/auth/guest-only";
import { LoginForm } from "@/components/forms/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <GuestOnly>
      <AuthLayoutCard
        below={<DemoLoginButton />}
        headerAction={{ prompt: "Don't have an account?", label: "Sign up", href: "/signup" }}
        icon={<LogIn />}
        title="Welcome back"
        subtitle="Sign in to your Qnetward account"
      >
        <LoginForm />
      </AuthLayoutCard>
    </GuestOnly>
  );
}
