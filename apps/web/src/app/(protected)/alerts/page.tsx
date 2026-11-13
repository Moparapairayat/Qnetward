import type { Metadata } from "next";
import { AlertRulesWorkspace } from "@/features/alert-rules/alert-rules-workspace";

export const metadata: Metadata = { title: "Alert rules" };

export default function AlertsPage() {
  return <AlertRulesWorkspace />;
}
