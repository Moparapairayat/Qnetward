import { Suspense } from "react";
import { TracerouteWorkspace } from "@/features/traceroute/traceroute-workspace";

export default function TraceroutePage() {
  // Suspense: the tool reads ?target= from the URL.
  return (
    <Suspense>
      <TracerouteWorkspace />
    </Suspense>
  );
}
