"use client";

import { QnetwardMark } from "@/features/landing/qnetward-mark";
import { ReactNode, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { SessionResponse } from "@/lib/types";
import { takeNext } from "@/lib/next-path";

/**
 * Shows its children only to signed-out visitors and sends anyone signed in to
 * the console. hold keeps a flow on screen after it signs the visitor in, like
 * signup's last step.
 */
export function GuestOnly({ children, hold = false }: { children: ReactNode; hold?: boolean }) {
  const router = useRouter();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => apiRequest<SessionResponse>("/api/auth/session"),
  });

  useEffect(() => {
    if (!hold && !session.isLoading && session.data?.authenticated) {
      router.replace(takeNext());
    }
  }, [hold, router, session.data?.authenticated, session.isLoading]);

  if (session.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Checking your session">
        <span className="lp-pulse">
          <QnetwardMark size={32} />
        </span>
      </div>
    );
  }

  if (session.data?.authenticated && !hold) {
    return null;
  }

  return <>{children}</>;
}
