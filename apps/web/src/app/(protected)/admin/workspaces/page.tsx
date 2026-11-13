import type { Metadata } from "next";
import { AdminWorkspacesWorkspace } from "@/features/admin/admin-workspaces-workspace";

export const metadata: Metadata = { title: "Workspaces · Admin" };

export default function AdminWorkspacesPage() {
  return <AdminWorkspacesWorkspace />;
}
