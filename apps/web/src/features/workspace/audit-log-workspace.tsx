"use client";

import { Fragment, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BellRing, Download, FileClock, KeyRound, Radar, Radio, Users } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import { auditEventDetail, describeAuditEvent, shortUserAgent } from "@/lib/audit";
import type { AuditEvent, AuditPage, WorkspaceTeamResponse } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { Notice, SettingsCard, SettingsPageTitle } from "@/components/settings/settings-ui";

type Category = "" | "member" | "monitor" | "alert" | "scan" | "export" | "apikey";

const categories: { id: Category; label: string }[] = [
  { id: "", label: "All" },
  { id: "member", label: "Members" },
  { id: "monitor", label: "Monitors" },
  { id: "alert", label: "Alert rules" },
  { id: "scan", label: "Scans" },
  { id: "export", label: "Exports" },
  { id: "apikey", label: "API keys" },
];

function AuditIcon({ action }: { action: string }) {
  const className = "h-3.5 w-3.5 text-[var(--lp-muted)]";
  if (action.startsWith("member.")) return <Users className={className} aria-hidden="true" />;
  if (action.startsWith("monitor.")) return <Radio className={className} aria-hidden="true" />;
  if (action.startsWith("alert_rule.")) return <BellRing className={className} aria-hidden="true" />;
  if (action.startsWith("scan.")) return <Radar className={className} aria-hidden="true" />;
  if (action.startsWith("history.")) return <Download className={className} aria-hidden="true" />;
  if (action.startsWith("apikey.")) return <KeyRound className={className} aria-hidden="true" />;
  return <FileClock className={className} aria-hidden="true" />;
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function EventRow({ event }: { event: AuditEvent }) {
  const detail = auditEventDetail(event);
  const agent = shortUserAgent(event.user_agent);
  return (
    <li className="flex gap-3 px-4 py-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[var(--lp-border-strong)] bg-white/[0.03]">
        <AuditIcon action={event.action} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="text-[var(--lp-text)]">{event.actor_email || "Someone"}</span>{" "}
          <span className="text-[var(--lp-muted)]">{describeAuditEvent(event).replace(/^./, (c) => c.toLowerCase())}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs text-[var(--lp-subtle)]">
          {detail ? <span className="lp-mono break-all">{detail}</span> : null}
          {event.ip_address ? <span className="lp-mono">{event.ip_address}</span> : null}
          {agent ? <span>{agent}</span> : null}
        </p>
      </div>
      <time className="shrink-0 pt-0.5 text-xs tabular-nums text-[var(--lp-subtle)]" dateTime={event.occurred_at} title={formatDateTime(event.occurred_at)}>
        {timeLabel(event.occurred_at)}
      </time>
    </li>
  );
}

export function AuditLogWorkspace() {
  const [category, setCategory] = useState<Category>("");
  const teamQuery = useQuery({ queryKey: ["workspace-team"], queryFn: () => apiRequest<WorkspaceTeamResponse>("/api/workspace/team") });
  const role = teamQuery.data?.workspace?.role;
  const canRead = role === "owner" || role === "admin";

  const auditQuery = useInfiniteQuery({
    queryKey: ["workspace-audit", category],
    enabled: canRead,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "50" });
      if (category) params.set("category", category);
      if (pageParam) params.set("before", String(pageParam));
      return apiRequest<AuditPage>(`/api/workspace/audit?${params}`);
    },
    getNextPageParam: (last) => last.next_before ?? undefined,
  });

  const events = auditQuery.data?.pages.flatMap((p) => p.events) ?? [];

  return (
    <div className="grid grid-cols-1 gap-5">
      <SettingsPageTitle
        title="Audit log"
        description="Who changed what in this workspace, and when. Entries can't be edited or deleted, and are kept for a year."
      />

      {teamQuery.isLoading ? null : !canRead ? (
        <Notice tone="info">Only workspace owners and admins can view the audit log.</Notice>
      ) : (
        <SettingsCard
          title="Activity"
          description="Members, monitors, alert rules, port scans, exports, and API keys."
        >
          {/* The strip scrolls on its own on narrow screens instead of widening the page. */}
          <div className="-mx-1 mb-3 overflow-x-auto px-1">
            <div className="inline-flex rounded-lg border border-[var(--lp-border)] p-0.5" role="tablist" aria-label="Filter events">
              {categories.map((c) => (
                <button
                  key={c.id || "all"}
                  type="button"
                  role="tab"
                  aria-selected={category === c.id}
                  onClick={() => setCategory(c.id)}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs transition-colors",
                    category === c.id ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          {auditQuery.isLoading ? (
            <p className="text-sm text-[var(--lp-subtle)]">Loading…</p>
          ) : auditQuery.isError ? (
            <Notice tone="error">{(auditQuery.error as ApiError).message || "Couldn't load the audit log."}</Notice>
          ) : events.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--lp-border)] px-4 py-8 text-center text-sm text-[var(--lp-subtle)]">
              Nothing recorded yet{category ? " in this category" : ""}.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-[var(--lp-border)]">
              <ul className="divide-y divide-[var(--lp-border)]">
                {events.map((event, i) => {
                  const day = dayLabel(event.occurred_at);
                  const newDay = i === 0 || dayLabel(events[i - 1].occurred_at) !== day;
                  return (
                    <Fragment key={event.id}>
                      {newDay ? (
                        <li className="bg-white/[0.02] px-4 py-1.5 text-xs font-medium uppercase tracking-[0.04em] text-[var(--lp-subtle)]">{day}</li>
                      ) : null}
                      <EventRow event={event} />
                    </Fragment>
                  );
                })}
              </ul>
              {auditQuery.hasNextPage ? (
                <div className="border-t border-[var(--lp-border)] p-2 text-center">
                  <button
                    type="button"
                    className="console-btn console-btn-secondary"
                    disabled={auditQuery.isFetchingNextPage}
                    onClick={() => auditQuery.fetchNextPage()}
                  >
                    {auditQuery.isFetchingNextPage ? "Loading" : "Load older"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </SettingsCard>
      )}
    </div>
  );
}
