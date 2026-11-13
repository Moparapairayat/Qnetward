"use client";

import "@/features/landing/landing.css";
import { ErrorScreen } from "@/components/app/route-states";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen reset={reset} digest={error.digest} />;
}
