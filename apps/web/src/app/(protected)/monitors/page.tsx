import type { Metadata } from "next";
import { MonitorsWorkspace } from "@/features/monitors/monitors-workspace";

export const metadata: Metadata = { title: "Monitors" };

export default function MonitorsPage() {
  return <MonitorsWorkspace />;
}
