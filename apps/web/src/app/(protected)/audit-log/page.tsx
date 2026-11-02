import { redirect } from "next/navigation";

// The audit log lives in workspace settings.
export default function AuditLogRedirect() {
  redirect("/workspace/audit-log");
}
