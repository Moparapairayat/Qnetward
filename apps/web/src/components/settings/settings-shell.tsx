"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Bot,
  Building2,
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
import { Avatar, roleLabel, WorkspaceAvatar } from "@/components/settings/settings-ui";

type NavItem = { href: string; label: string; icon: LucideIcon; soon?: boolean };

const personalItems: NavItem[] = [
  { href: "/settings/profile", label: "Profile", icon: User },
  { href: "/settings/account", label: "Account", icon: Settings2 },
  { href: "/settings/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/security", label: "Password and sessions", icon: Shield },
  { href: "/settings/workspaces", label: "Workspaces", icon: Building2 },
];

const workspaceItems: NavItem[] = [
  { href: "/workspace/general", label: "General", icon: Settings2 },
  { href: "/workspace/team", label: "Team", icon: Users },
  { href: "/workspace/billing", label: "Billing and plan", icon: CreditCard },
  { href: "/workspace/integrations", label: "Integrations", icon: Plug },
  { href: "/workspace/api-keys", label: "API keys", icon: KeyRound },
  { href: "/workspace/audit-log", label: "Audit log", icon: FileClock },
];

const soonItems: NavItem[] = [{ href: "/sso", label: "SSO and SCIM", icon: Bot, soon: true }];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-[34px] items-center gap-2.5 rounded-md px-3 text-[13px] font-medium transition-colors",
        active ? "bg-white/[0.08] text-white" : "text-[#d0d0d7] hover:bg-white/[0.05] hover:text-white",
      )}
    >
      {active ? <span className="absolute -left-2 top-1.5 bottom-1.5 w-[3px] rounded-full bg-[var(--lp-accent)]" aria-hidden="true" /> : null}
      <item.icon className={cn("h-4 w-4", active ? "text-white" : "text-[#9a9aa4]")} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.soon ? <span className="rounded border border-[var(--lp-border-strong)] px-1.5 text-[10px] leading-[18px] text-[var(--lp-muted)]">Soon</span> : null}
    </Link>
  );
}

/** A nav section's heading: who or what the links below configure. */
function SectionHeading({ badge, title, meta }: { badge: ReactNode; title: string; meta?: string }) {
  return (
    <div className="mb-1 flex min-w-0 items-center gap-2.5 px-3 py-1.5">
      {badge}
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-[var(--lp-text)]">{title}</p>
        {meta ? <p className="truncate text-[11px] text-[var(--lp-subtle)]">{meta}</p> : null}
      </div>
    </div>
  );
}

/**
 * Settings in one place: your own account and the active workspace sit side
 * by side in a single menu, each under a heading that says whose settings
 * they are, so there's no mode to switch between.
 */
export function SettingsShell({ children }: { context?: "personal" | "workspace"; children: ReactNode }) {
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
    enabled: session.data?.authenticated === true,
  });
  const user = session.data?.user;
  const activeId = workspaces.data?.active_workspace_id ?? session.data?.active_workspace_id;
  const workspace = workspaces.data?.workspaces?.find((w) => w.id === activeId) ?? workspaces.data?.workspaces?.[0];
  const workspaceName = workspace?.name || "Workspace";
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);


  return (
    <div className="mx-auto w-full max-w-[1180px]">
      <header className="pb-6">
        <h1 className="text-[22px] font-medium tracking-[-0.02em]">Settings</h1>
        <p className="mt-1 text-[13px] text-[var(--lp-muted)]">
          Your own account, and everything shared in <span className="text-[var(--lp-text)]">{workspaceName}</span>.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="Settings" className="min-w-0">
          {/* Small screens: one scrollable row, account links then workspace links. */}
          <ul className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 lg:hidden">
            {[...personalItems, null, ...workspaceItems].map((item, i) =>
              item === null ? (
                <li key="divider" className="mx-1 h-5 w-px shrink-0 bg-[var(--lp-border-strong)]" aria-hidden="true" />
              ) : (
                <li key={item.href ?? i}>
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
              ),
            )}
          </ul>

          <div className="hidden lg:block">
            <SectionHeading
              badge={<Avatar name={user?.name} email={user?.email} src={profile.data?.avatar_url || null} size={24} />}
              title="Your account"
              meta={user?.email}
            />
            <ul className="grid gap-0.5">
              {personalItems.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} active={isActive(item.href)} />
                </li>
              ))}
            </ul>

            <div className="mt-4 border-t border-[var(--lp-border)] pt-4">
              <SectionHeading
                badge={<WorkspaceAvatar name={workspace?.name} id={workspace?.id} size={24} />}
                title={workspaceName}
                meta={workspace?.role ? `Workspace · you are ${roleLabel(workspace.role).toLowerCase()}` : "Workspace"}
              />
              <ul className="grid gap-0.5">
                {[...workspaceItems, ...soonItems].map((item) => (
                  <li key={item.href}>
                    <NavLink item={item} active={isActive(item.href)} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </nav>

        <div className="min-w-0 max-w-[760px]">{children}</div>
      </div>
    </div>
  );
}
