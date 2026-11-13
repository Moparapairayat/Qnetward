import type { PublicPlansResponse } from "@/lib/types";

const backendBase = process.env.QNETWARD_BACKEND_URL ?? process.env.NETWATCHER_BACKEND_URL ?? "http://127.0.0.1:8080";

/**
 * The public price list, read on the server so the landing page arrives with
 * real prices in its HTML. Refreshed every five minutes; null when the API
 * can't be reached (for example during a build), and the page then asks for it
 * from the browser instead.
 */
export async function fetchPublicPlans(): Promise<PublicPlansResponse | null> {
  try {
    const resp = await fetch(`${backendBase}/api/plans`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(3000) });
    return resp.ok ? ((await resp.json()) as PublicPlansResponse) : null;
  } catch {
    return null;
  }
}
