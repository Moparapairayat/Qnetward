import { Suspense } from "react";
import { VerifyEmailFlow } from "@/components/forms/verify-email-form";

export default function VerifyEmailPage() {
  // The flow reads ?email= from the URL, which needs a Suspense boundary.
  return (
    <Suspense>
      <VerifyEmailFlow />
    </Suspense>
  );
}
