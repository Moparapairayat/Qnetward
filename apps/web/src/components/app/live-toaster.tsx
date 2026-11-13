"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useNoticeStore, type LiveNotice } from "@/store/notice-store";

const tone: Record<string, { icon: typeof Info; ring: string; text: string; bar: string }> = {
  critical: { icon: XCircle, ring: "border-[rgba(255,61,127,0.35)]", text: "text-[#ff8fb3]", bar: "bg-[#ff3d7f]" },
  warning: { icon: AlertTriangle, ring: "border-[rgba(251,191,36,0.3)]", text: "text-[#fcd34d]", bar: "bg-[#fbbf24]" },
  success: { icon: CheckCircle2, ring: "border-[rgba(74,222,128,0.3)]", text: "text-[#86efac]", bar: "bg-[#4ade80]" },
  info: { icon: Info, ring: "border-[var(--lp-border)]", text: "text-[var(--lp-muted)]", bar: "bg-[var(--lp-subtle)]" },
};

// Critical alerts stay until dismissed; others leave on their own.
const lifetime = (severity: string) => (severity === "critical" ? 0 : severity === "warning" ? 12_000 : 7_000);

function Toast({ notice }: { notice: LiveNotice }) {
  const dismiss = useNoticeStore((s) => s.dismiss);
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const t = tone[notice.severity] ?? tone.info;
  const Icon = t.icon;
  const ms = lifetime(notice.severity);
  const remaining = useRef(ms);
  const started = useRef(0);

  const close = () => {
    setLeaving(true);
    setTimeout(() => dismiss(notice.id), 180);
  };

  // Count down while not hovered; hovering keeps it on screen.
  useEffect(() => {
    if (!ms || paused) return;
    started.current = Date.now();
    const timer = setTimeout(close, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, ms]);

  const content = (
    <>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", t.text)} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-[var(--lp-text)]">{notice.title}</span>
        {notice.body ? <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-[var(--lp-muted)]">{notice.body}</span> : null}
      </span>
    </>
  );

  return (
    <li
      role={notice.severity === "critical" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={cn(
        "pointer-events-auto relative w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border bg-[#1b1b1f]/95 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur transition-all duration-200",
        t.ring,
        leaving ? "translate-x-4 opacity-0" : "animate-[toast-in_220ms_ease-out]",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-0.5", t.bar)} aria-hidden />
      <div className="flex items-start gap-3 py-3 pl-4 pr-10">
        {notice.href ? (
          <Link href={notice.href} onClick={close} className="flex min-w-0 flex-1 items-start gap-3">
            {content}
          </Link>
        ) : (
          content
        )}
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded-md p-1 text-[var(--lp-subtle)] transition-colors hover:bg-white/[0.06] hover:text-[var(--lp-text)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/**
 * Shows live alerts as toasts in the corner, and counts the ones that arrive
 * while the tab is in the background in its title, like "(2) Qnetward".
 */
export function LiveToaster() {
  const notices = useNoticeStore((s) => s.notices);
  const unseen = useNoticeStore((s) => s.unseen);
  const clearUnseen = useNoticeStore((s) => s.clearUnseen);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") clearUnseen();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [clearUnseen]);

  // Prefix the page title while there are unseen alerts. Next sets each page's
  // own title on navigation, so watch the title and put the count back.
  useEffect(() => {
    const strip = (title: string) => title.replace(/^\(\d+\) /, "");
    const apply = () => {
      const want = unseen > 0 ? `(${unseen}) ${strip(document.title)}` : strip(document.title);
      if (document.title !== want) document.title = want;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [unseen]);

  return (
    <ol aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
      {notices.map((n) => (
        <Toast key={n.id} notice={n} />
      ))}
    </ol>
  );
}
