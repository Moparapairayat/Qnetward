"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Check, ChevronDown, ChevronsUpDown, LogOut, PanelLeftClose, PanelLeftOpen, Settings, Shield, User, Users, X } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { AlertRule, SessionResponse, WorkspaceListResponse } from "@/lib/types";
import { useShellStore } from "@/store/ui-store";
import { QnetwardMark } from "@/features/landing/qnetward-mark";
import { isSettingsPath, sectionOpenByDefault, sidebarSections, type NavItem } from "@/components/app/nav-config";
import { cn } from "@/lib/utils";

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return value.trim().slice(0, 2).toUpperCase() || "?";
}

/** Closes a popover on outside click or Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
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

/** Label shown beside an icon-only control when the rail is collapsed. */
function RailTip({ label, show }: { label: string; show: boolean }) {
  if (!show) return null;
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-[var(--lp-border-strong)] bg-[#1d1d22] px-2 py-1 text-[12px] text-[var(--lp-text)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {label}
    </span>
  );
}

function WorkspaceSwitcher({ session, collapsed }: { session: SessionResponse; collapsed: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const isDemo = session.mode === "demo";

  const list = useQuery({
    queryKey: ["workspace-list"],
    queryFn: () => apiRequest<WorkspaceListResponse>("/api/workspaces"),
    enabled: session.authenticated,
  });

  const switchWorkspace = useMutation({
    mutationFn: (workspaceID: number) =>
      apiRequest<{ ok: boolean; message: string }>("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ workspace_id: workspaceID }),
      }),
    onSuccess: async () => {
      setOpen(false);
      await queryClient.invalidateQueries();
      router.refresh();
    },
  });

  const workspaces = list.data?.workspaces ?? [];
  const activeID = list.data?.active_workspace_id ?? session.active_workspace_id;
  const active = workspaces.find((w) => w.id === activeID) ?? workspaces[0];
  const name = active?.name ?? (isDemo ? "Demo workspace" : "Workspace");
  const meta = isDemo ? "Shared sandbox" : active ? `${active.plan} plan · ${active.role}` : "Loading…";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Workspace: ${name}`}
        className={cn(
          "group relative flex w-full items-center gap-2.5 rounded-lg border border-[var(--lp-border)] bg-white/[0.02] text-left transition-colors hover:bg-white/[0.05]",
          collapsed ? "justify-center p-1.5" : "px-2.5 py-2",
        )}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[linear-gradient(135deg,#ff3d7f,#8b5cf6)] text-[10px] font-semibold text-white">
          {initials(name)}
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-[var(--lp-text)]">{name}</span>
              <span className={cn("block truncate text-[11px] text-[var(--lp-subtle)]", !isDemo && "capitalize")}>{meta}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--lp-subtle)]" />
          </>
        )}
        <RailTip label={name} show={collapsed} />
      </button>

      {open ? (
        <div role="menu" className={cn("console-popover absolute top-full z-50 mt-1 p-1", collapsed ? "left-0 w-56" : "left-0 right-0")}>
          <p className="px-2 pb-1 pt-1.5 text-[11px] text-[var(--lp-subtle)]">Switch workspace</p>
          {workspaces.length === 0 ? <p className="px-2 py-1.5 text-[13px] text-[var(--lp-muted)]">{name}</p> : null}
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              role="menuitem"
              disabled={switchWorkspace.isPending}
              onClick={() => (w.id === activeID ? setOpen(false) : switchWorkspace.mutate(w.id))}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-[var(--lp-text)] hover:bg-white/[0.05]"
            >
              <span className="grid h-5 w-5 place-items-center rounded bg-white/[0.06] text-[10px]">{initials(w.name)}</span>
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.id === activeID ? <Check className="h-3.5 w-3.5 text-[var(--lp-accent)]" /> : null}
            </button>
          ))}
          <div className="my-1 h-px bg-[var(--lp-border)]" />
          <Link
            href="/workspace/team"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-[var(--lp-muted)] hover:bg-white/[0.05] hover:text-[var(--lp-text)]"
          >
            <Users className="h-3.5 w-3.5" /> Manage team
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function UserMenu({ session, collapsed }: { session: SessionResponse; collapsed: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const isDemo = session.mode === "demo";
  const displayName = session.user?.name?.trim() || session.user?.email || "Account";

  const logout = useMutation({
    mutationFn: () => apiRequest<{ ok: boolean }>("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      router.replace("/login");
    },
  });

  return (
    <div ref={ref} className="relative">
      {open ? (
        <div role="menu" className={cn("console-popover absolute bottom-full z-50 mb-1 p-1", collapsed ? "left-0 w-56" : "left-0 right-0")}>
          <div className="px-2 py-1.5">
            <p className="truncate text-[13px] text-[var(--lp-text)]">{displayName}</p>
            <p className="truncate text-[12px] text-[var(--lp-subtle)]">{session.user?.email}</p>
          </div>
          <div className="my-1 h-px bg-[var(--lp-border)]" />
          {[
            { href: "/settings/profile", label: "Settings", icon: User },
            { href: "/settings/security", label: "Password and sessions", icon: Shield },
            { href: "/status", label: "System status", icon: Activity },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-[var(--lp-text)] hover:bg-white/[0.05]"
            >
              <item.icon className="h-3.5 w-3.5 text-[var(--lp-subtle)]" /> {item.label}
            </Link>
          ))}
          <div className="my-1 h-px bg-[var(--lp-border)]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-[#ff8fb3] hover:bg-[rgba(255,61,127,0.08)]"
          >
            <LogOut className="h-3.5 w-3.5" /> {logout.isPending ? "Signing out…" : isDemo ? "Leave demo" : "Sign out"}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${displayName}`}
        className={cn(
          "group relative flex w-full items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-white/[0.04]",
          collapsed ? "justify-center p-1.5" : "px-2 py-2",
        )}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#2a2a31] text-[11px] font-semibold text-[var(--lp-text)] ring-1 ring-[var(--lp-border-strong)]">
          {initials(displayName)}
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-[var(--lp-text)]">{displayName}</span>
              <span className="block truncate text-[11px] text-[var(--lp-subtle)]">{isDemo ? "Demo session" : session.user?.email}</span>
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[var(--lp-subtle)]" />
          </>
        )}
        <RailTip label={displayName} show={collapsed} />
      </button>
    </div>
  );
}

function NavLink({
  item,
  active,
  collapsed,
  badge,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  badge?: number;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[rgba(255,61,127,0.45)]",
        collapsed ? "h-9 justify-center" : "h-[34px] px-2.5",
        active ? "bg-white/[0.08] text-white" : "text-[#d0d0d7] hover:bg-white/[0.05] hover:text-white",
      )}
    >
      {active && !collapsed ? <span className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-[var(--lp-accent)]" aria-hidden="true" /> : null}
      <item.icon
        className={cn("h-4 w-4 shrink-0", active ? "text-[var(--lp-accent)]" : "text-[#9a9aa4] group-hover:text-[#d0d0d7]")}
      />
      {collapsed ? null : <span className="flex-1 truncate">{item.label}</span>}
      {item.soon && !collapsed ? (
        <span className="rounded border border-[var(--lp-border-strong)] px-1.5 text-[10px] leading-[18px] text-[var(--lp-muted)]">Soon</span>
      ) : null}
      {badge ? (
        <span
          className={cn(
            "grid min-w-[18px] place-items-center rounded-full bg-[var(--lp-accent)] px-1 text-[10px] font-semibold leading-[18px] text-white",
            collapsed && "absolute right-1 top-1 min-w-[14px] text-[9px] leading-[14px]",
          )}
          aria-label={`${badge} firing`}
        >
          {badge}
        </span>
      ) : null}
      <RailTip label={badge ? `${item.label} · ${badge} firing` : item.soon ? `${item.label} · preview` : item.label} show={collapsed} />
    </Link>
  );
}

export function Sidebar({ session }: { session: SessionResponse }) {
  const pathname = usePathname();
  const { sidebarOpen, setSidebarOpen, sidebarCollapsed, toggleSidebarCollapsed, sectionState, setSectionOpen } = useShellStore();
  const isDemo = session.mode === "demo";
  const isAdmin = session.platform_role === "admin";
  // The rail only collapses on desktop; the mobile drawer is always full width.
  const collapsed = sidebarCollapsed && !sidebarOpen;

  // Shares the overview's cache key, so this adds no extra request on that page.
  const alertRules = useQuery({
    queryKey: ["alert-rules"],
    queryFn: () => apiRequest<AlertRule[]>("/api/alerts/rules"),
    refetchInterval: 60_000,
    enabled: session.authenticated && !session.read_only,
  });
  const firing = (alertRules.data ?? []).filter((r) => r.enabled && r.last_state === "alert").length;

  const close = () => setSidebarOpen(false);

  return (
    <>
      {sidebarOpen ? <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden" onClick={close} aria-hidden="true" /> : null}

      <aside
        aria-label="Sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-[var(--lp-border)] bg-[#111114] transition-[transform,width] duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          collapsed ? "w-[60px]" : "w-64",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* brand row */}
        <div className={cn("flex h-14 items-center border-b border-[var(--lp-border)]", collapsed ? "justify-center" : "justify-between px-3")}>
          {collapsed ? null : (
            <Link href="/overview" className="flex items-center gap-2" aria-label="Qnetward overview">
              <QnetwardMark size={24} />
              <span className="text-[15px] font-semibold tracking-tight">Qnetward</span>
            </Link>
          )}
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="group relative hidden h-8 w-8 place-items-center rounded-md text-[var(--lp-subtle)] transition-colors hover:bg-white/[0.05] hover:text-[var(--lp-text)] lg:grid"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            <RailTip label="Expand sidebar" show={collapsed} />
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="Close navigation"
            className="grid h-8 w-8 place-items-center rounded-md text-[var(--lp-subtle)] hover:bg-white/[0.05] hover:text-[var(--lp-text)] lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className={cn("space-y-2 pt-3", collapsed ? "px-2" : "px-3")}>
          <WorkspaceSwitcher session={session} collapsed={collapsed} />
        </div>

        <nav className={cn("flex-1 pb-4 pt-1", collapsed ? "overflow-visible px-2" : "lp-scroll-subtle overflow-y-auto px-3")} aria-label="Main">
          {sidebarSections(isAdmin).map((section) => {
            const hasActive = section.items.some((item) => item.href === pathname);
            const single = section.items.length === 1;
            const open = sectionState[section.label] ?? sectionOpenByDefault(section);
            // A one-item section has no header to unfold it with.
            const folded = !collapsed && !single && !hasActive && !open;
            return (
              <div key={section.label} className="mt-1.5 first:mt-2">
                {collapsed ? (
                  <div className="mx-auto mb-2 h-px w-6 bg-[var(--lp-border)]" aria-hidden="true" />
                ) : single ? null : (
                  <button
                    type="button"
                    onClick={() => setSectionOpen(section.label, folded)}
                    aria-expanded={!folded}
                    className="group mb-0.5 flex h-[34px] w-full items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-[#b8b8c0] transition-colors hover:bg-white/[0.04] hover:text-white"
                  >
                    <span className="flex-1 text-left">{section.label}</span>
                    {folded ? <span className="text-[12px] tabular-nums text-[var(--lp-muted)]">{section.items.length}</span> : null}
                    <ChevronDown className={cn("h-4 w-4 opacity-70 transition-transform group-hover:opacity-100", folded && "-rotate-90")} />
                  </button>
                )}
                {folded ? null : (
                  <ul className="space-y-0.5">
                    {section.items.map((item) => (
                      <li key={item.href}>
                        <NavLink
                          item={item}
                          active={pathname === item.href}
                          collapsed={collapsed}
                          badge={item.href === "/alerts" ? firing : undefined}
                          onNavigate={close}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <div className={cn("space-y-2 border-t border-[var(--lp-border)] py-2", collapsed ? "px-2" : "px-3")}>
          {isDemo && !collapsed ? (
            <p className="rounded-md border border-[rgba(251,191,36,0.25)] bg-[rgba(251,191,36,0.06)] px-2.5 py-2 text-[12px] leading-snug text-[var(--lp-amber)]">
              Shared demo. Other visitors can see what you run here.
            </p>
          ) : null}
          <NavLink
            item={{ href: "/workspace/team", label: "Settings", icon: Settings }}
            active={isSettingsPath(pathname)}
            collapsed={collapsed}
            onNavigate={close}
          />
          <UserMenu session={session} collapsed={collapsed} />
        </div>
      </aside>
    </>
  );
}
