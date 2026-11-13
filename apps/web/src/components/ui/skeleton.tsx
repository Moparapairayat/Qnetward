import { cn } from "@/lib/utils";

/** A grey placeholder that stands where content will appear while it loads. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-white/[0.06] motion-reduce:animate-none", className)} />;
}
