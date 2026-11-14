import Link from "next/link";

/**
 * Shown on something the workspace's plan doesn't cover any more (its paid
 * period ended): it's kept, but waits until there's room or the plan grows.
 */
export function OverPlanNote({ what }: { what: string }) {
  return (
    <Link href="/upgrade" className="text-[#fbbf24] hover:underline" title={`Your plan covers fewer ${what} than this workspace has. The oldest ones run; this one waits until you upgrade or turn another off.`}>
      Waiting: over your plan&apos;s limit
    </Link>
  );
}
