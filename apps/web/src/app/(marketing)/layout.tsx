import type { Metadata } from "next";
import "@/features/landing/landing.css";

export const metadata: Metadata = {
  title: "Qnetward — Network, infrastructure, and security observability",
  description:
    "Probe, monitor, and protect every network and server from one platform. Live ping, port scan, DNS, alerting, and team workspaces.",
};

export default function MarketingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="lp-root">{children}</div>;
}
