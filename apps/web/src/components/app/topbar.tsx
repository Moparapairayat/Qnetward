"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, Check, ExternalLink, FileText, HelpCircle, Keyboard, Mail, Menu, Search, X } from "@/components/icons";
import { apiRequest } from "@/lib/api";
import { AlertRule, SessionResponse, WorkspaceInvitationsResponse } from "@/lib/types";
import { useShellStore } from "@/store/ui-store";
import { cn } from "@/lib/utils";

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

const iconButton =
  "relative grid h-8 w-8 place-items-center rounded-md text-[var(--lp-muted)] transition-colors hover:bg-white/[0.05] hover:text-[var(--lp-text)] aria-expanded:bg-white/[0.06] aria-expanded:text-[var(--lp-text)]";

function since(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Notifications({ session }: { session: SessionResponse }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const enabled = session.authenticated && !session.read_only;

  // Same cache keys as the sidebar and overview, so these add no duplicate requests.
  const alerts = useQuery({
    queryKey: ["alert-rules"],
    queryFn: () => apiRequest<AlertRule[]>("/api/alerts/rules"),
    refetchInterval: 60_000,
    enabled,
  });
  const invitations = useQuery({
    queryKey: ["incoming-workspace-invitations"],
    queryFn: () => apiRequest<WorkspaceInvitationsResponse>("/api/workspace/invitations"),
    refetchInterval: 120_000,
    enabled,
  });
  const accept = useMutation({
    mutationFn: (invitationID: number) =>
      apiRequest<{ ok: boolean }>("/api/workspace/invitations", {
        method: "POST",
        body: JSON.stringify({ invitation_id: invitationID, action: "accept" }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["incoming-workspace-invitations"] });
      await queryClient.invalidateQueries({ queryKey: ["workspace-list"] });
    },
  });

  const firing = (alerts.data ?? []).filter((r) => r.enabled && r.last_state === "alert");
  const pending = (invitations.data?.invitations ?? []).filter((i) => i.status === "pending");
  const count = firing.length + pending.length;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={iconButton}
        aria-label={count ? `Notifications, ${count} new` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {count ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {count ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--lp-accent)] ring-2 ring-[#141417]" /> : null}
      </button>
      {open ? (
        <div role="dialog" aria-label="Notifications" className="console-popover absolute right-0 top-full z-50 mt-2 w-[340px] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--lp-border)] px-4 py-3">
            <p className="text-sm font-medium">Notifications</p>
            {count ? <span className="text-xs text-[var(--lp-subtle)]">{count} need attention</span> : null}
          </div>
          <div className="max-h-[380px] overflow-y-auto">
            {firing.map((rule) => (
              <Link
                key={`a${rule.id}`}
                href="/alerts"
                onClick={() => setOpen(false)}
                className="flex gap-3 border-b border-[var(--lp-border)] px-4 py-3 hover:bg-white/[0.03]"
              >
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--lp-accent)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--lp-text)]">{rule.name || rule.target} is alerting</span>
                  <span className="block truncate text-xs text-[var(--lp-subtle)]">
                    {rule.target}
                    {rule.port ? `:${rule.port}` : ""}
                    {rule.last_triggered_at ? ` · since ${since(rule.last_triggered_at)}` : ""}
                  </span>
                </span>
              </Link>
            ))}
            {pending.map((inv) => (
              <div key={`i${inv.id}`} className="flex gap-3 border-b border-[var(--lp-border)] px-4 py-3">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#c4b5fd]" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--lp-text)]">
                    {inv.inviter_name} invited you to <span className="font-medium">{inv.workspace_name ?? "a workspace"}</span>
                  </p>
                  <p className="text-xs capitalize text-[var(--lp-subtle)]">as {inv.role}</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="console-btn console-btn-primary h-7 px-2.5 text-xs"
                      disabled={accept.isPending}
                      onClick={() => accept.mutate(inv.id)}
                    >
                      <Check className="h-3 w-3" /> Accept
                    </button>
                    <Link href="/settings/workspaces" onClick={() => setOpen(false)} className="console-btn console-btn-secondary h-7 px-2.5 text-xs">
                      Review
                    </Link>
                  </div>
                </div>
              </div>
            ))}
            {count === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="mx-auto h-5 w-5 text-[var(--lp-subtle)]" />
                <p className="mt-2 text-sm text-[var(--lp-muted)]">You&apos;re all caught up</p>
                <p className="mt-1 text-xs text-[var(--lp-subtle)]">Firing alerts and workspace invitations show up here.</p>
              </div>
            ) : null}
          </div>
          <Link
            href="/alerts"
            onClick={() => setOpen(false)}
            className="block border-t border-[var(--lp-border)] px-4 py-2.5 text-center text-xs text-[var(--lp-muted)] hover:text-[var(--lp-text)]"
          >
            Manage alert rules
          </Link>
        </div>
      ) : null}
    </div>
  );
}

const shortcuts: [keys: string[], action: string][] = [
  [["Ctrl", "K"], "Search pages"],
  [["Ctrl", "B"], "Collapse or expand the sidebar"],
  [["↑", "↓"], "Move through search results"],
  [["Enter"], "Open the selected page"],
  [["Esc"], "Close menus and dialogs"],
];

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 px-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="console-popover w-full max-w-[420px]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--lp-border)] px-5 py-3.5">
          <p className="text-base font-medium">Keyboard shortcuts</p>
          <button type="button" onClick={onClose} aria-label="Close" className={iconButton}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="p-2">
          {shortcuts.map(([keys, action]) => (
            <li key={action} className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm">
              <span className="text-[var(--lp-muted)]">{action}</span>
              <span className="flex gap-1">
                {keys.map((k) => (
                  <kbd
                    key={k}
                    className="min-w-[24px] rounded border border-[var(--lp-border-strong)] bg-white/[0.04] px-1.5 py-0.5 text-center text-2xs text-[var(--lp-text)]"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="border-t border-[var(--lp-border)] px-5 py-3 text-xs text-[var(--lp-subtle)]">On macOS, use ⌘ instead of Ctrl.</p>
      </div>
    </div>
  );
}

function HelpMenu() {
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const item = "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-[var(--lp-text)] hover:bg-white/[0.05]";
  return (
    <div ref={ref} className="relative">
      <button type="button" className={iconButton} aria-label="Help" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <HelpCircle className="h-4 w-4" />
      </button>
      {open ? (
        <div role="menu" className="console-popover absolute right-0 top-full z-50 mt-2 w-56 p-1">
          <button
            type="button"
            role="menuitem"
            className={cn(item, "w-full")}
            onClick={() => {
              setOpen(false);
              setShortcutsOpen(true);
            }}
          >
            <Keyboard className="h-4 w-4 text-[var(--lp-subtle)]" /> Keyboard shortcuts
          </button>
          <Link href="/" role="menuitem" className={item} onClick={() => setOpen(false)}>
            <ExternalLink className="h-4 w-4 text-[var(--lp-subtle)]" /> Qnetward website
          </Link>
          <div className="my-1 h-px bg-[var(--lp-border)]" />
          <Link href="/terms" role="menuitem" className={item} onClick={() => setOpen(false)}>
            <FileText className="h-4 w-4 text-[var(--lp-subtle)]" /> Terms
          </Link>
          <Link href="/privacy" role="menuitem" className={item} onClick={() => setOpen(false)}>
            <FileText className="h-4 w-4 text-[var(--lp-subtle)]" /> Privacy
          </Link>
          <p className="px-2.5 pb-1.5 pt-2 text-2xs text-[var(--lp-subtle)]">Qnetward beta</p>
        </div>
      ) : null}
      {/* Portal to the console root: the sticky, blurred header would otherwise trap this fixed overlay. */}
      {shortcutsOpen
        ? createPortal(<ShortcutsDialog onClose={() => setShortcutsOpen(false)} />, document.querySelector(".lp-console") ?? document.body)
        : null}
    </div>
  );
}

export function Topbar({ session }: { session: SessionResponse }) {
  const { toggleSidebar, setPaletteOpen, toggleSidebarCollapsed } = useShellStore();
  const isDemo = session.mode === "demo";

  // Ctrl/Cmd+B folds the desktop sidebar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebarCollapsed();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebarCollapsed]);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--lp-border)] bg-[#141417]/85 px-4 backdrop-blur-md lg:px-8">
      <button type="button" onClick={toggleSidebar} aria-label="Open navigation" className={cn(iconButton, "-ml-1 lg:hidden")}>
        <Menu className="h-5 w-5" />
      </button>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="hidden h-9 w-full max-w-[340px] items-center gap-2.5 rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 text-sm text-[var(--lp-subtle)] transition-colors hover:border-[var(--lp-border-strong)] hover:text-[var(--lp-muted)] sm:flex"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Search pages…</span>
        <kbd className="rounded border border-[var(--lp-border)] px-1.5 py-px text-2xs">Ctrl K</kbd>
      </button>
      <button type="button" onClick={() => setPaletteOpen(true)} aria-label="Search pages" className={cn(iconButton, "sm:hidden")}>
        <Search className="h-4 w-4" />
      </button>

      <div className="ml-auto flex items-center gap-1">
        {isDemo ? (
          <span className="mr-2 rounded-md border border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.06)] px-2 py-0.5 text-xs text-[var(--lp-amber)]">
            Demo
          </span>
        ) : null}
        <Notifications session={session} />
        <HelpMenu />
      </div>
    </header>
  );
}
