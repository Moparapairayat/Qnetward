import type { Metadata } from "next";
import { NotificationsSettings } from "@/features/settings/personal/notifications-settings";

export const metadata: Metadata = { title: "Notifications · Settings" };

export default function Page() {
  return <NotificationsSettings />;
}
