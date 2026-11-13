import type { Metadata } from "next";
import { TeamWorkspace } from "@/features/workspace/team-workspace";

export const metadata: Metadata = { title: "Team · Settings" };

export default function WorkspaceTeamPage() {
  return <TeamWorkspace />;
}
