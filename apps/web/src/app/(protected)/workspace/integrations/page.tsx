import type { Metadata } from "next";
import { IntegrationsWorkspace } from "@/features/workspace/integrations-workspace";

export const metadata: Metadata = { title: "Integrations · Settings" };

export default function WorkspaceIntegrationsPage() {
  return <IntegrationsWorkspace />;
}
