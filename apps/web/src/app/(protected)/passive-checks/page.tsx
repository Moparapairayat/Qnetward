import type { Metadata } from "next";
import { Suspense } from "react";
import { PassiveChecksWorkspace } from "@/features/passive-checks/passive-checks-workspace";

export const metadata: Metadata = { title: "Passive checks" };

export default function PassiveChecksPage() {
  // Suspense: the page reads ?domain= and ?scan= from the URL.
  return (
    <Suspense>
      <PassiveChecksWorkspace />
    </Suspense>
  );
}
