"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Bell,
  Bot,
  Building2,
  Check,
  ChevronDown,
  CreditCard,
  FileClock,
  KeyRound,
  Plug,
  Settings2,
  Shield,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { apiRequest } from "@/lib/api";
import type { SessionResponse, UserProfileResponse, WorkspaceListResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Avatar, initialsFor, roleLabel } from "@/components/settings/settings-ui";

type NavItem = { href: string; label: string; icon: LucideIcon; soon?: boolean };
type NavGroup = { label?: string; items: NavItem[] };

const personalNav: NavGroup[] = [
  {
    items: [
      { href: "/settings/profile", label: "Profile", icon: User },
      { href: "/settings/account", label: "Account", icon: Settings2 },
      { href: "/settings/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Access",
    items: [
      { href: "/settings/security", label: "Password and sessions", icon: Shield },
      { href: "/settings/workspaces", label: "Workspaces", icon: Building2 },
    ],
  },
];

const workspaceNav: NavGroup[] = [
  {
    items: [
      { href: "/workspace/team", label: "Team", icon: Users },
      { href: "/workspace/billing", label: "Billing and plan", icon: CreditCard },
      { href: "/workspace/audit-log", label: "Audit log", icon: FileClock },
    ],
  },
  {
    label: "Coming soon",
    items: [
      { href: "/integrations", label: "Integrations", icon: Plug, soon: true },
      { href: "/api-keys", label: "API keys", icon: KeyRound, soon: true },
      { href: "/sso", label: "SSO and SCIM", icon: Bot, soon: true },
    ],
  },
];

function ContextSwitcher({ context, workspaceName }: { context: "personal" | "workspace"; workspaceName?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options = [
    { id: "personal", href: "/settings/profile", label: "Personal account", hint: "Profile, password, notifications" },
    { id: "workspace", href: "/workspace/team", label: workspaceName ?? "Workspace", hint: "Team, billing, integrations" },
  ];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="console-btn console-btn-secondary"
      >
        <ArrowLeftRight className="h-3.5 w-3.5" /> Switch settings context
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div role="menu" className="console-popover absolute right-0 z-40 mt-1 w-72 p-1">
          {options.map((option) => (
            <Link
              key={option.id}
              href={option.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-white/[0.05]"
            >
              <span className="mt-0.5 grid h-4 w-4 place-items-center">
                {context === option.id ? <Check className="h-3.5 w-3.5 text-[var(--lp-accent)]" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-[var(--lp-text)]">{option.label}</span>
                <span className="block text-[12px] text-[var(--lp-subtle)]">{option.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Settings layout in the GitHub mould: who or what you're configuring at the
 * top, with a context switch, and a section menu beside the content.
 */
export function SettingsShell({ context, children }: { context: "personal" | "workspace"; children: ReactNode }) {
  const pathname = usePathname();
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => apiRequest<SessionResponse>("/api/auth/session"),
  });
  const workspaces = useQuery({
    queryKey: ["workspace-list"],
    queryFn: () => apiRequest<WorkspaceListResponse>("/api/workspaces"),
    enabled: session.data?.authenticated === true,
  });
  const profile = useQuery({
    queryKey: ["account-profile"],
    queryFn: () => apiRequest<UserProfileResponse>("/api/account/profile"),
    enabled: context === "personal" && session.data?.authenticated === true,
  });
  const user = session.data?.user;
  const activeId = workspaces.data?.active_workspace_id ?? session.data?.active_workspace_id;
  const workspace = workspaces.data?.workspaces?.find((w) => w.id === activeId) ?? workspaces.data?.workspaces?.[0];
  const groups = context === "personal" ? personalNav : workspaceNav;
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <header className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {context === "personal" ? (
            <Avatar name={user?.name} email={user?.email} src={profile.data?.avatar_url || null} size={44} />
          ) : (
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-[14px] font-medium" aria-hidden="true">
              {initialsFor(workspace?.name)}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[17px] font-medium tracking-[-0.01em]">
              {context === "personal" ? user?.name || user?.email || "Your account" : workspace?.name || "Workspace"}
              {context === "personal" && user?.email ? <span className="ml-2 text-[14px] font-normal text-[var(--lp-subtle)]">{user.email}</span> : null}
            </p>
            <p className="text-[13px] text-[var(--lp-muted)]">
              {context === "personal" ? "Your personal account" : `Workspace settings${workspace?.role ? ` · you are ${roleLabel(workspace.role).toLowerCase()}` : ""}`}
            </p>
          </div>
        </div>
        <ContextSwitcher context={context} workspaceName={workspace?.name} />
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10">
        <nav aria-label={context === "personal" ? "Personal settings" : "Workspace settings"} className="min-w-0">
          {/* Small screens: one scrollable row of tabs. */}
          <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:hidden">
            {groups
              .flatMap((g) => g.items)
              .filter((item) => !item.soon)
              .map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px]",
                      isActive(item.href) ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]",
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5" /> {item.label}
                  </Link>
                </li>
              ))}
          </ul>

          <div className="hidden lg:block">
            {groups.map((group, gi) => (
              <div key={group.label ?? gi} className={cn(gi > 0 && "mt-3 border-t border-[var(--lp-border)] pt-3")}>
                {group.label ? <p className="px-3 pb-1.5 text-[12px] text-[var(--lp-subtle)]">{group.label}</p> : null}
                <ul className="grid gap-0.5">
                  {group.items.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] transition-colors",
                            active ? "bg-white/[0.06] font-medium text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:bg-white/[0.03] hover:text-[var(--lp-text)]",
                          )}
                        >
                          {active ? <span className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[var(--lp-accent)]" aria-hidden="true" /> : null}
                          <item.icon className={cn("h-4 w-4", active ? "text-[var(--lp-text)]" : "text-[var(--lp-subtle)]")} />
                          <span className="flex-1 truncate">{item.label}</span>
                          {item.soon ? <span className="rounded border border-[var(--lp-border)] px-1 text-[10px] leading-4 text-[var(--lp-subtle)]">Soon</span> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0 max-w-[760px]">{children}</div>
      </div>
    </div>
  );
}
