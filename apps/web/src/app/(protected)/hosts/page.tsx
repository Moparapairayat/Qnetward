import type { Metadata } from "next";
import { HostsWorkspace } from "@/features/hosts/hosts-workspace";

export const metadata: Metadata = { title: "Hosts" };

export default function HostsPage() {
  return <HostsWorkspace />;
}
