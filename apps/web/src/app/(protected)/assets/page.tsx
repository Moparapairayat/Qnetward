import type { Metadata } from "next";
import { AssetsWorkspace } from "@/features/assets/assets-workspace";

export const metadata: Metadata = { title: "Assets" };

export default function AssetsPage() {
  return <AssetsWorkspace />;
}
