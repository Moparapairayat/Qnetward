import type { Metadata } from "next";
import { WorkspacesSettings } from "@/features/settings/personal/workspaces-settings";

export const metadata: Metadata = { title: "Workspaces · Settings" };

export default function Page() {
  return <WorkspacesSettings />;
}
