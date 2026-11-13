import { LandingPage } from "@/features/landing/landing-page";
import { fetchPublicPlans } from "@/lib/plans-server";

// Prices and limits come from the API; the page is rebuilt every five minutes.
export const revalidate = 300;

export default async function HomePage() {
  return <LandingPage plans={await fetchPublicPlans()} />;
}
