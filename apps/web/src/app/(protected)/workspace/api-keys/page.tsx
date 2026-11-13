import type { Metadata } from "next";
import { APIKeysWorkspace } from "@/features/workspace/api-keys-workspace";

export const metadata: Metadata = { title: "API keys · Settings" };

export default function WorkspaceAPIKeysPage() {
  return <APIKeysWorkspace />;
}
