"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useShellStore } from "@/store/ui-store";

// What each event makes stale. Keys are prefixes, so ["overview-history"]
// covers every target's history query.
const STALE: Record<string, string[][]> = {
  "monitor.check": [["monitors"], ["monitor-series"], ["recent-history-targets"], ["overview-history"]],
  "alert.changed": [["alert-rules"]],
  "agent.changed": [["agents"], ["hosts"], ["devices"]],
  "host.changed": [["hosts"], ["host-series"], ["host-alerts"]],
  "device.changed": [["devices"], ["device-series"]],
  "security.scan": [["security-scans"], ["security-scan"], ["surface-scans"], ["surface-scan"], ["security-watches"], ["vulnerabilities"], ["compliance"], ["deep-scans"]],
};

/**
 * Keeps one Server-Sent Events stream open for the console and refetches what
 * an event touches. Bursts are folded into one refetch.
 *
 * Every event carries an id. When the connection drops, the browser reconnects
 * on its own and sends the last id it saw, and the server replays what was
 * missed. If the gap can't be filled, the server sends "resync" and every
 * query is refetched, so the console is never quietly out of date.
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
    const onResync = () => {
      pending.clear();
      if (timer) clearTimeout(timer);
      timer = null;
      void queryClient.invalidateQueries();
    };

    // "ready" arrives once the stream is caught up, which is when it's truly live.
    source.addEventListener("ready", () => setLiveConnected(true));
    source.addEventListener("resync", onResync);
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
