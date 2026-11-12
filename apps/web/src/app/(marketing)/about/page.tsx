import type { Metadata } from "next";
import { AboutPage } from "@/features/landing/about-page";

export const metadata: Metadata = {
  title: "About — Qnetward",
  description: "Why we're building one place to watch your network, servers, and security, and the principles behind it.",
};

export default function About() {
  return <AboutPage />;
}
