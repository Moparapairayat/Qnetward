import type { Metadata } from "next";
import { AdminDeepScansWorkspace } from "@/features/admin/admin-deep-scans-workspace";

export const metadata: Metadata = { title: "Deep scans · Admin" };

export default function AdminDeepScansPage() {
  return <AdminDeepScansWorkspace />;
}
