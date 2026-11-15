import type { Metadata } from "next";
import { ChangelogPage } from "@/features/landing/changelog-page";

export const metadata: Metadata = {
  title: "Changelog — Qnetward",
  description: "What's new in Qnetward: features, improvements, and fixes, newest first.",
};

export default function Changelog() {
  return <ChangelogPage />;
}
