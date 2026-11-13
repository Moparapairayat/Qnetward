"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useShellStore } from "@/store/ui-store";
import { useNoticeStore } from "@/store/notice-store";
import { liveBus } from "@/lib/live-bus";

const MONITORS = [["monitors"], ["monitor-series"], ["recent-history-targets"], ["overview-history"]];
const SECURITY = [["security-scans"], ["security-scan"], ["surface-scans"], ["surface-scan"], ["security-watches"], ["vulnerabilities"], ["compliance"], ["deep-scans"], ["deep-scan"], ["asset-domains"]];
const AUDIT = [["workspace-audit"]];

// What each event makes stale. Keys are prefixes, so ["overview-history"]
// covers every target's history query.
const STALE: Record<string, string[][]> = {
  "monitor.check": MONITORS,
  "monitor.changed": [...MONITORS, ["status-pages"], ...AUDIT],
  "alert.changed": [["alert-rules"], ...AUDIT],
  "agent.changed": [["agents"], ["hosts"], ["devices"], ...AUDIT],
  "host.changed": [["hosts"], ["host-series"], ["host-alerts"]],
  "device.changed": [["devices"], ["device-series"], ...AUDIT],
  "security.scan": SECURITY,
  "security.changed": [...SECURITY, ...AUDIT],
  "status_page.changed": [["status-pages"], ...AUDIT],
  "workspace.changed": [["workspace-general"], ["workspace-team"], ["workspace-channels"], ["workspace-api-keys"], ["workspace-billing"], ["workspace-usage"], ["workspace-list"], ...AUDIT],
};

// A toast's "group" is the alert channel it belongs to; refresh what it's about.
const NOTICE_GROUP: Record<string, string> = {
  monitors: "monitor.check",
  certificates: "monitor.check",
  alert_rules: "alert.changed",
  agents: "agent.changed",
  hosts: "host.changed",
  security: "security.changed",
};

// Alerts older than this when they arrive (replayed after a reconnect) refresh
// data but don't pop up.
const TOAST_MAX_AGE = 2 * 60_000;

/**
 * Keeps one Server-Sent Events stream open for the console, refetches what an
 * event touches, and shows alerts as toasts. Bursts are folded into one refetch.
 *
 * Every event carries an id. When the connection drops, the browser reconnects
 * on its own and sends the last id it saw, and the server replays what was
 * missed. If the gap can't be filled, the server sends "resync" and every
 * query is refetched, so the console is never quietly out of date.
 */
export function LiveEvents() {
  const queryClient = useQueryClient();
  const setLiveConnected = useShellStore((s) => s.setLiveConnected);
  const pushNotice = useNoticeStore((s) => s.push);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events");
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const keys = new Set<string>();
      for (const type of pending) for (const key of STALE[type] ?? []) keys.add(JSON.stringify(key));
      pending.clear();
      for (const key of keys) void queryClient.invalidateQueries({ queryKey: JSON.parse(key) });
    };
    const mark = (type: string) => {
      pending.add(type);
      timer ??= setTimeout(flush, 300);
    };
    const onEvent = (e: MessageEvent) => mark(e.type);
    const onNotice = (e: MessageEvent) => {
      let evt: { at?: number; notice?: { severity: string; title: string; body?: string; href?: string }; data?: { group?: string } };
      try {
        evt = JSON.parse(e.data);
      } catch {
        return;
      }
      const group = evt.data?.group;
      if (group && NOTICE_GROUP[group]) mark(NOTICE_GROUP[group]);
      const at = evt.at ?? Date.now();
      if (!evt.notice || Date.now() - at > TOAST_MAX_AGE) return;
      pushNotice({ id: e.lastEventId || `${at}-${evt.notice.title}`, ...evt.notice, at });
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
    source.addEventListener("notice", onNotice);
    // Second-by-second readings go to the pages showing them, not to refetches.
    const onReading = (e: MessageEvent) => {
      try {
        liveBus?.dispatchEvent(new CustomEvent(e.type, { detail: JSON.parse(e.data) }));
      } catch {
        /* ignore a malformed reading */
      }
    };
    source.addEventListener("host.live", onReading);
    source.addEventListener("device.live", onReading);
    source.onerror = () => setLiveConnected(false);
    for (const type of Object.keys(STALE)) source.addEventListener(type, onEvent);

    return () => {
      source.close();
      if (timer) clearTimeout(timer);
      setLiveConnected(false);
    };
  }, [queryClient, setLiveConnected, pushNotice]);

  return null;
}
