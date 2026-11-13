import type { Metadata } from "next";
import "@/features/landing/landing.css";
import { NotFoundScreen } from "@/components/app/route-states";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return <NotFoundScreen />;
}
