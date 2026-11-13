"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";

/**
 * Live readings (host.live, device.live) arrive on the console's event stream
 * every second or two. They're too frequent for query refetches, so the stream
 * hands them to this bus and the pages that show them listen directly.
 */
export const liveBus = typeof window === "undefined" ? null : new EventTarget();

export type LiveReading<T> = { at: number; sample: T };

/**
 * Turns on Live mode for a host or device while the page is open and visible,
 * and keeps the latest readings. The server's Live mode lasts 90 seconds, so
 * it's renewed every minute; leaving or hiding the page lets it lapse.
 */
export function useLiveReadings<T>(kind: "host" | "device", id: number, keep = 90) {
  const [readings, setReadings] = useState<LiveReading<T>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastAt = useRef(0);

  useEffect(() => {
    if (!liveBus) return;
    const type = kind === "host" ? "host.live" : "device.live";
    const key = kind === "host" ? "agent_id" : "device_id";
    const onReading = (e: Event) => {
      const data = (e as CustomEvent<{ at: number; data: Record<string, unknown> }>).detail;
      if (Number(data.data?.[key]) !== id) return;
      lastAt.current = data.at;
      setReadings((prev) => [...prev, { at: data.at, sample: data.data.sample as T }].slice(-keep));
    };
    liveBus.addEventListener(type, onReading);
    return () => liveBus.removeEventListener(type, onReading);
  }, [kind, id, keep]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      void apiRequest(`/api/${kind === "host" ? "hosts" : "devices"}/live?id=${id}`, { method: "POST" })
        .then(() => setError(null))
        .catch((e: Error) => setError(e.message));
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        start();
        timer ??= setInterval(start, 60_000);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) clearInterval(timer);
    };
  }, [kind, id]);

  // "Live" means a reading arrived in the last few seconds.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const streaming = readings.length > 0 && now - readings[readings.length - 1].at < 5000;

  return { readings, streaming, error };
}
