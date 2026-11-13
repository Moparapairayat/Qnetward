import type { Metadata } from "next";
import { AuditLogWorkspace } from "@/features/workspace/audit-log-workspace";

export const metadata: Metadata = { title: "Audit log · Settings" };

export default function WorkspaceAuditLogPage() {
  return <AuditLogWorkspace />;
}
