"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useShellStore } from "@/store/ui-store";

// What each event makes stale. Keys are prefixes, so ["overview-history"]
// covers every target's history query.
const STALE: Record<string, string[][]> = {
  "monitor.check": [["monitors"], ["monitor-series"], ["recent-history-targets"], ["overview-history"]],
  "alert.changed": [["alert-rules"]],
  "agent.changed": [["agents"]],
};

/**
 * Keeps one Server-Sent Events stream open for the console and refetches what
 * an event touches. Bursts are folded into one refetch. The browser reconnects
 * on its own; while it's down, the queries' normal polling carries on.
 */
export function LiveEvents() {
  const queryClient = useQueryClient();
  const setLiveConnected = useShellStore((s) => s.setLiveConnected);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events");
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      for (const type of pending) {
        for (const queryKey of STALE[type] ?? []) void queryClient.invalidateQueries({ queryKey });
      }
      pending.clear();
    };
    const onEvent = (e: MessageEvent) => {
      pending.add(e.type);
      timer ??= setTimeout(flush, 400);
    };

    source.onopen = () => setLiveConnected(true);
    source.onerror = () => setLiveConnected(false);
    for (const type of Object.keys(STALE)) source.addEventListener(type, onEvent);

    return () => {
      source.close();
      if (timer) clearTimeout(timer);
      setLiveConnected(false);
    };
  }, [queryClient, setLiveConnected]);

  return null;
}
