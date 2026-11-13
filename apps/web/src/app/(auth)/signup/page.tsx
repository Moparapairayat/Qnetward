import type { Metadata } from "next";
import { SignupFlow } from "@/components/forms/signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default function SignupPage() {
  return <SignupFlow />;
}
