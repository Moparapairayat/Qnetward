import type { Metadata } from "next";
import { StatusPagesWorkspace } from "@/features/status-pages/status-pages-workspace";

export const metadata: Metadata = { title: "Status pages" };

export default function StatusPagesPage() {
  return <StatusPagesWorkspace />;
}
