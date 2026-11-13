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
import { LiveToaster } from "@/components/app/live-toaster";
import { ConsoleShellSkeleton } from "@/components/app/route-states";
import { clearNext, peekNext } from "@/lib/next-path";

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => apiRequest<SessionResponse>("/api/auth/session"),
  });

  useEffect(() => {
    if (!session.isLoading && !session.data?.authenticated) {
      // Come back to this page after signing in.
      const here = window.location.pathname + window.location.search;
      router.replace(pathname === "/overview" ? "/login" : `/login?next=${encodeURIComponent(here)}`);
      return;
    }
    // Google sign-in always lands on the overview; go on to where the visitor
    // was headed when they started (a pricing link, say). Anywhere else, they
    // have arrived, so the remembered destination is done with.
    if (!session.isLoading && session.data?.authenticated) {
      const next = peekNext();
      if (next && pathname === "/overview" && !session.data.read_only) {
        router.replace(next);
        return;
      }
      if (next) clearNext();
    }
    if (!session.isLoading && session.data?.read_only && pathname !== "/overview") {
      router.replace("/overview");
    }
    if (!session.isLoading && pathname.startsWith("/admin") && session.data?.platform_role !== "admin") {
      router.replace("/overview");
    }
  }, [pathname, router, session.data?.authenticated, session.data?.platform_role, session.data?.read_only, session.isLoading]);

  // While the session is checked, and while a redirect is on its way, show the
  // console frame instead of a blank screen.
  if (
    session.isLoading ||
    !session.data?.authenticated ||
    (session.data.read_only && pathname !== "/overview") ||
    (pathname.startsWith("/admin") && session.data.platform_role !== "admin")
  ) {
    return <ConsoleShellSkeleton />;
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
