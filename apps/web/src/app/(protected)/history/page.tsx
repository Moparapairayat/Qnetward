import type { Metadata } from "next";
import { HistoryWorkspace } from "@/features/history/history-workspace";

export const metadata: Metadata = { title: "History" };

export default function HistoryPage() {
  return <HistoryWorkspace />;
}
