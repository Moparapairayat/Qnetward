import type { Metadata } from "next";
import { AdminOverviewWorkspace } from "@/features/admin/admin-overview-workspace";

export const metadata: Metadata = { title: "Admin" };

export default function AdminPage() {
  return <AdminOverviewWorkspace />;
}
