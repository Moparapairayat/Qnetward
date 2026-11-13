import type { Metadata } from "next";
import { AdminUsersWorkspace } from "@/features/admin/admin-users-workspace";

export const metadata: Metadata = { title: "Users · Admin" };

export default function AdminUsersPage() {
  return <AdminUsersWorkspace />;
}
