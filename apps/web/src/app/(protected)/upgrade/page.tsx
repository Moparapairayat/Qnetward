import type { Metadata } from "next";
import { Suspense } from "react";
import { UpgradeWorkspace } from "@/features/workspace/upgrade-workspace";

export const metadata: Metadata = { title: "Plans" };

export default function UpgradePage() {
  // Suspense: the page reads ?period= from the URL.
  return (
    <Suspense>
      <UpgradeWorkspace />
    </Suspense>
  );
}
