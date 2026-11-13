"use client";

import { ErrorScreen } from "@/components/app/route-states";

// A crash in one console page keeps the sidebar and top bar, so the rest of the app stays reachable.
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen reset={reset} digest={error.digest} inConsole />;
}
