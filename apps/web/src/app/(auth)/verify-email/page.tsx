import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmailFlow } from "@/components/forms/verify-email-form";

export const metadata: Metadata = { title: "Verify your email" };

export default function VerifyEmailPage() {
  // The flow reads ?email= from the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <VerifyEmailFlow />
    </Suspense>
  );
}
