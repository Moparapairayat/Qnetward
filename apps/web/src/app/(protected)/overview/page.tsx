import type { Metadata } from "next";
import { OverviewWorkspace } from "@/features/overview/overview-workspace";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return <OverviewWorkspace />;
}
