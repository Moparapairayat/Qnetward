import { Suspense } from "react";
import { PassiveChecksWorkspace } from "@/features/passive-checks/passive-checks-workspace";

export default function PassiveChecksPage() {
  // Suspense: the page reads ?domain= and ?scan= from the URL.
  return (
    <Suspense>
      <PassiveChecksWorkspace />
    </Suspense>
  );
}
