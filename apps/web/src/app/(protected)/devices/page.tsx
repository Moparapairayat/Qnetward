import type { Metadata } from "next";
import { DevicesWorkspace } from "@/features/devices/devices-workspace";

export const metadata: Metadata = { title: "Devices" };

export default function DevicesPage() {
  return <DevicesWorkspace />;
}
