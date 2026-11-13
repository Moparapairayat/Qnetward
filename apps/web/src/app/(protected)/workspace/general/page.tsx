import type { Metadata } from "next";
import { WorkspaceGeneral } from "@/features/workspace/general-workspace";

export const metadata: Metadata = { title: "General · Settings" };

export default function WorkspaceGeneralPage() {
  return <WorkspaceGeneral />;
}
