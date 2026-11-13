import type { Metadata } from "next";
import { SecuritySettings } from "@/features/settings/personal/security-settings";

export const metadata: Metadata = { title: "Security · Settings" };

export default function Page() {
  return <SecuritySettings />;
}
