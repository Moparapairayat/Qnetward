import type { Metadata } from "next";
import { AdminSystemWorkspace } from "@/features/admin/admin-system-workspace";

export const metadata: Metadata = { title: "System · Admin" };

export default function AdminSystemPage() {
  return <AdminSystemWorkspace />;
}
