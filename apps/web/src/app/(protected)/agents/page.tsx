import type { Metadata } from "next";
import { AgentsWorkspace } from "@/features/agents/agents-workspace";

export const metadata: Metadata = { title: "Probe agents" };

export default function AgentsPage() {
  return <AgentsWorkspace />;
}
