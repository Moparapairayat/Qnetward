import type { Metadata } from "next";
import { ComplianceWorkspace } from "@/features/compliance/compliance-workspace";

export const metadata: Metadata = { title: "Compliance" };

export default function CompliancePage() {
  return <ComplianceWorkspace />;
}
