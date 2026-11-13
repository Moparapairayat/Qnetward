"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BellRing, Mail, MessageSquare, Webhook } from "@/components/icons";
import { apiRequest } from "@/lib/api";
import type { AlertRule, SessionResponse } from "@/lib/types";
import { SettingsCard, SettingsPageTitle } from "@/components/settings/settings-ui";

function ChannelRow({ icon: Icon, title, detail, status }: { icon: typeof Mail; title: string; detail: string; status: "on" | "soon" }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-[var(--lp-border-strong)] bg-white/[0.03]">
        <Icon className="h-3.5 w-3.5 text-[var(--lp-muted)]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm">{title}</p>
        <p className="truncate text-xs text-[var(--lp-subtle)]">{detail}</p>
      </div>
      {status === "on" ? (
        <span className="shrink-0 rounded-md border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] px-2 py-0.5 text-xs text-[#86efac]">On</span>
      ) : (
        <span className="shrink-0 rounded-md border border-[var(--lp-border)] px-2 py-0.5 text-xs text-[var(--lp-subtle)]">Soon</span>
      )}
    </li>
  );
}

export function NotificationsSettings() {
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => apiRequest<SessionResponse>("/api/auth/session") });
  const rulesQuery = useQuery({
    queryKey: ["alert-rules"],
    queryFn: () => apiRequest<AlertRule[]>("/api/alerts/rules"),
    enabled: sessionQuery.data?.authenticated === true,
  });
  const email = sessionQuery.data?.user?.email ?? "";
  const rules = rulesQuery.data ?? [];
  const mine = rules.filter((rule) => rule.enabled && rule.recipient_email.toLowerCase() === email.toLowerCase());
  const elsewhere = rules.filter((rule) => rule.enabled && rule.recipient_email.toLowerCase() !== email.toLowerCase());

  return (
    <div className="grid grid-cols-1 gap-5">
      <SettingsPageTitle title="Notifications" description="Where Qnetward reaches you, and what it sends." />

      <SettingsCard
        id="alerts"
        title="Alert emails"
        description="Each alert rule emails one address when it fires and, if you choose, when it recovers."
        hint={
          rulesQuery.isLoading
            ? "Checking your rules…"
            : elsewhere.length
              ? `${elsewhere.length} other active ${elsewhere.length === 1 ? "rule sends" : "rules send"} to a different address.`
              : null
        }
        action={
          <Link href="/alerts" className="console-btn console-btn-secondary">
            <BellRing className="h-3.5 w-3.5" /> Manage alert rules
          </Link>
        }
      >
        {mine.length ? (
          <ul className="divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)]">
            {mine.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">{rule.name}</span>
                <span className="lp-mono shrink-0 text-xs text-[var(--lp-subtle)]">
                  {rule.protocol === "tcpping" && rule.port ? `${rule.target}:${rule.port}` : rule.target}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--lp-border)] px-4 py-5 text-center text-sm text-[var(--lp-subtle)]">
            {rulesQuery.isLoading ? "Loading…" : <>No active rules send to <span className="lp-mono">{email}</span>.</>}
          </p>
        )}
      </SettingsCard>

      <SettingsCard id="channels" title="Channels" description="Account emails always go to your sign-in address. Chat and webhook delivery arrive with Integrations.">
        <ul className="divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)]">
          <ChannelRow icon={Mail} title="Email" detail={email || "—"} status="on" />
          <ChannelRow icon={MessageSquare} title="Slack, Discord, Telegram" detail="Post alerts to a channel" status="soon" />
          <ChannelRow icon={Webhook} title="Webhooks" detail="Send alert events to your own endpoint" status="soon" />
        </ul>
      </SettingsCard>
    </div>
  );
}
