import type { Metadata } from "next";
import { Suspense } from "react";
import { PingToolClient } from "@/components/tools/ping-tool-client";

export const metadata: Metadata = { title: "ICMP ping" };

export default function ICMPPingPage() {
  // Suspense: the tool reads ?target= from the URL.
  return (
    <Suspense>
      <PingToolClient mode="ping" />
    </Suspense>
  );
}
