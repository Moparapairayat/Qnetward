import type { Metadata } from "next";
import { BillingWorkspace } from "@/features/workspace/billing-workspace";

export const metadata: Metadata = { title: "Billing · Settings" };

export default function WorkspaceBillingPage() {
  return <BillingWorkspace />;
}
