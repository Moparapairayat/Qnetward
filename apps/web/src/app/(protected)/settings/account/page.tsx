import type { Metadata } from "next";
import { AccountSettings } from "@/features/settings/personal/account-settings";

export const metadata: Metadata = { title: "Account · Settings" };

export default function Page() {
  return <AccountSettings />;
}
