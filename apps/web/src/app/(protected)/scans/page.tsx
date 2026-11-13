import type { Metadata } from "next";
import { DeepScansWorkspace } from "@/features/deep-scans/deep-scans-workspace";

export const metadata: Metadata = { title: "Scans" };

export default function DeepScansPage() {
  return <DeepScansWorkspace />;
}
