import { useShellStore } from "@/store/ui-store";

/**
 * A refetch interval that steps back while the live event stream is connected.
 * Events are resumable, so while live the poll is only a safety net (five
 * minutes by default). Pages whose data can go stale without an event, such as
 * an agent going quiet, pass a shorter liveMs.
 */
export function useLiveInterval(ms: number, liveMs = 300_000) {
  const live = useShellStore((s) => s.liveConnected);
  return live ? Math.max(ms, liveMs) : ms;
}
