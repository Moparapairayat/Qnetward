import type { Metadata } from "next";
import { Suspense } from "react";
import { PortScanClient } from "@/components/tools/port-scan-client";

export const metadata: Metadata = { title: "Port scan" };

export default function PortScanPage() {
  // Suspense: the tool reads ?target= from the URL.
  return (
    <Suspense>
      <PortScanClient />
    </Suspense>
  );
}
