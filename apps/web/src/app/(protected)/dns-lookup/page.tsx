import type { Metadata } from "next";
import { Suspense } from "react";
import { DNSInspectorWorkspace } from "@/features/dns-inspector/dns-inspector-workspace";

export const metadata: Metadata = { title: "DNS lookup" };

export default function DNSLookupPage() {
  // Suspense: the tool reads ?target= from the URL.
  return (
    <Suspense>
      <DNSInspectorWorkspace />
    </Suspense>
  );
}
