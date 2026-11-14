"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { QnetwardMark } from "@/features/landing/qnetward-mark";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The console's frame (sidebar, top bar, a page of placeholders) shown while
 * the session is checked, so the app appears at once in its own colours
 * instead of a blank screen.
 */
export function ConsoleShellSkeleton() {
  return (
    <div className="flex min-h-screen bg-[#000000]" role="status" aria-label="Loading your workspace">
      <div className="hidden w-64 shrink-0 flex-col gap-2 border-r border-[var(--lp-border)] bg-[#000000] lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-[var(--lp-border)] px-3">
          <QnetwardMark size={24} />
          <span className="text-md font-semibold text-[var(--lp-text)]">Qnetward</span>
        </div>
        <div className="flex flex-col gap-2 p-3">
          <Skeleton className="mb-3 h-14 w-full rounded-lg" />
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="h-7" />
          ))}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-[var(--lp-border)] px-4 lg:px-8">
          <span className="lg:hidden">
            <QnetwardMark size={24} />
          </span>
          <Skeleton className="h-9 w-full max-w-[340px]" />
        </div>
        <div className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1280px]">
            <PageSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Placeholders for a typical console page: a heading, a row of cards and a table. */
export function PageSkeleton() {
  return (
    <div className="grid gap-5" aria-hidden="true">
      <div className="grid gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[140px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-[300px] rounded-xl" />
    </div>
  );
}

type StateScreenProps = {
  code: string;
  title: string;
  message: string;
  actions: ReactNode;
  /** Full screen on the public site; inside the console it sits in the page area. */
  fullScreen?: boolean;
};

function StateScreen({ code, title, message, actions, fullScreen }: StateScreenProps) {
  const body = (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <QnetwardMark size={40} />
      <p className="mt-6 font-mono text-sm text-[var(--lp-accent,#ff3d7f)]">{code}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--lp-text,#ededf0)]">{title}</h1>
      <p className="mt-3 text-base text-[var(--lp-muted,#a3a3ab)]">{message}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{actions}</div>
    </div>
  );
  if (!fullScreen) return <div className="flex min-h-[60vh] items-center justify-center">{body}</div>;
  return <div className="lp-root flex min-h-screen items-center justify-center bg-[#000000]">{body}</div>;
}

const primary =
  "inline-flex h-10 items-center justify-center rounded-lg bg-[#ff3d7f] px-4 text-sm font-medium text-white transition-colors hover:bg-[#ff5a93] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d7f]/50";
const secondary =
  "inline-flex h-10 items-center justify-center rounded-lg border border-white/[0.14] bg-white/[0.03] px-4 text-sm font-medium text-[#ededf0] transition-colors hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff3d7f]/50";

export function NotFoundScreen({ inConsole }: { inConsole?: boolean }) {
  return (
    <StateScreen
      code="404"
      title="This page doesn't exist"
      message="The link may be old or mistyped. Nothing is lost; pick up from one of these."
      fullScreen={!inConsole}
      actions={
        inConsole ? (
          <Link href="/overview" className={primary}>
            Back to overview
          </Link>
        ) : (
          <>
            <Link href="/" className={primary}>
              Go to the home page
            </Link>
            <Link href="/overview" className={secondary}>
              Open the console
            </Link>
          </>
        )
      }
    />
  );
}

export function ErrorScreen({ reset, digest, inConsole }: { reset: () => void; digest?: string; inConsole?: boolean }) {
  return (
    <StateScreen
      code={digest ? `Error · ${digest}` : "Error"}
      title="Something went wrong"
      message="This page hit a problem it couldn't recover from. Trying again usually fixes it; if it keeps happening, let us know the code above."
      fullScreen={!inConsole}
      actions={
        <>
          <button type="button" onClick={reset} className={primary}>
            Try again
          </button>
          <Link href={inConsole ? "/overview" : "/"} className={secondary}>
            {inConsole ? "Back to overview" : "Go to the home page"}
          </Link>
        </>
      }
    />
  );
}
