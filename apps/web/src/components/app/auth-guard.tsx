"use client";

import { ReactNode, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { SessionResponse } from "@/lib/types";
import { Sidebar } from "@/components/app/sidebar";
import { LiveEvents } from "@/components/app/live-events";
import { Topbar } from "@/components/app/topbar";
import { CommandPalette } from "@/components/app/command-palette";
import { QnetwardMark } from "@/features/landing/qnetward-mark";
import { LiveToaster } from "@/components/app/live-toaster";

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => apiRequest<SessionResponse>("/api/auth/session"),
  });

  useEffect(() => {
    if (!session.isLoading && !session.data?.authenticated) {
      router.replace("/login");
    }
    if (!session.isLoading && session.data?.read_only && pathname !== "/overview") {
      router.replace("/overview");
    }
    if (!session.isLoading && pathname.startsWith("/admin") && session.data?.platform_role !== "admin") {
      router.replace("/overview");
    }
  }, [pathname, router, session.data?.authenticated, session.data?.platform_role, session.data?.read_only, session.isLoading]);

  if (session.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading your workspace">
        <span className="lp-pulse">
          <QnetwardMark size={32} />
        </span>
      </div>
    );
  }

  if (!session.data?.authenticated) {
    return null;
  }

  if (session.data.read_only && pathname !== "/overview") {
    return null;
  }

  if (pathname.startsWith("/admin") && session.data.platform_role !== "admin") {
    return null;
  }

  return (
    <div className="flex min-h-screen">
      <LiveEvents />
      <LiveToaster />
      <Sidebar session={session.data} />
      <CommandPalette isAdmin={session.data.platform_role === "admin"} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar session={session.data} />
        <main id="main" className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
