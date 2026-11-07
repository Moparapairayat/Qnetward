import { useShellStore } from "@/store/ui-store";

/**
 * A refetch interval that relaxes while the live event stream is connected:
 * events trigger refetches as things change, so polling becomes a safety net.
 */
export function useLiveInterval(ms: number) {
  const live = useShellStore((s) => s.liveConnected);
  return live ? Math.max(ms, 60_000) : ms;
}
