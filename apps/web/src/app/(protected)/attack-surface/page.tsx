import { Suspense } from "react";
import { AttackSurfaceWorkspace } from "@/features/attack-surface/attack-surface-workspace";

export default function AttackSurfacePage() {
  // Suspense: the page reads ?scan= from the URL.
  return (
    <Suspense>
      <AttackSurfaceWorkspace />
    </Suspense>
  );
}
