import type { Metadata } from "next";
import { SettingsWorkspace } from "@/features/settings/settings-workspace";

export const metadata: Metadata = { title: "System status" };

export default function StatusPage() {
  return <SettingsWorkspace />;
}
