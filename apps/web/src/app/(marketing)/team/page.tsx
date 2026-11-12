import type { Metadata } from "next";
import { TeamPage } from "@/features/landing/team-page";

export const metadata: Metadata = {
  title: "Team — Qnetward",
  description: "The people building Qnetward in the open on GitHub.",
};

export default function Team() {
  return <TeamPage />;
}
