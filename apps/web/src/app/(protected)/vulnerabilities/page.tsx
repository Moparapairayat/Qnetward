import type { Metadata } from "next";
import { VulnerabilitiesWorkspace } from "@/features/vulnerabilities/vulnerabilities-workspace";

export const metadata: Metadata = { title: "Vulnerabilities" };

export default function VulnerabilitiesPage() {
  return <VulnerabilitiesWorkspace />;
}
