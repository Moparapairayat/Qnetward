import type { Metadata } from "next";
import { Suspense } from "react";
import { PingToolClient } from "@/components/tools/ping-tool-client";

export const metadata: Metadata = { title: "TCP ping" };

export default function TCPPingPage() {
  // Suspense: the tool reads ?target= from the URL.
  return (
    <Suspense>
      <PingToolClient mode="tcpping" />
    </Suspense>
  );
}
