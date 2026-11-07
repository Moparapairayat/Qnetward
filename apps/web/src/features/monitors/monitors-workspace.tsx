"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Radio, Trash2, X } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { Monitor, MonitorCheck, MonitorPayload, MonitorProtocol, SessionResponse } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { Field, PageHeader, Panel, RunStatus, StatStrip, Toggle } from "@/components/tools/probe-ui";
import { useLiveInterval } from "@/lib/live";

const MAX_MONITORS = 20;
const RECENT_SLOTS = 30;

const intervals = [
  { seconds: 30, label: "30 sec" },
  { seconds: 60, label: "1 min" },
  { seconds: 300, label: "5 min" },
  { seconds: 600, label: "10 min" },
  { seconds: 1800, label: "30 min" },
  { seconds: 3600, label: "1 hour" },
] as const;

const monitorSchema = z
  .object({
    id: z.number().int().positive().optional(),
    name: z.string().trim().max(80, "80 characters at most").optional(),
    protocol: z.enum(["http", "tcpping", "ping"]),
    target: z.string().trim().min(1, "Target is required"),
    port: z.preprocess((v) => (v === "" || v === null || Number.isNaN(v) ? undefined : Number(v)), z.number().int().optional()),
    expected_status: z.preprocess(
      (v) => (v === "" || v === null || Number.isNaN(v) ? undefined : Number(v)),
      z.number().int().min(100, "100 to 599").max(599, "100 to 599").optional(),
    ),
    interval_seconds: z.number().int(),
    notify_email: z.union([z.literal(""), z.string().trim().email("Enter a valid email or leave it empty")]),
    enabled: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.protocol === "tcpping" && (!value.port || value.port < 1 || value.port > 65535)) {
      ctx.addIssue({ code: "custom", path: ["port"], message: "Port 1 to 65535" });
    }
    if (value.protocol === "http" && /^[a-z]+:\/\//i.test(value.target) && !/^https?:\/\//i.test(value.target)) {
      ctx.addIssue({ code: "custom", path: ["target"], message: "Use an http:// or https:// URL" });
    }
  });

type MonitorFormInput = z.input<typeof monitorSchema>;
type MonitorFormValues = z.output<typeof monitorSchema>;
type MonitorState = "down" | "up" | "pending" | "paused";
type MonitorFilter = "all" | MonitorState;

const stateMeta: Record<MonitorState, { label: string; dot: string; pill: string }> = {
  down: { label: "Down", dot: "#ff3d7f", pill: "border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.1)] text-[#ff8fb3]" },
  up: { label: "Up", dot: "#4ade80", pill: "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]" },
  pending: { label: "Waiting for first check", dot: "#a78bfa", pill: "border-[rgba(167,139,250,0.3)] bg-[rgba(167,139,250,0.08)] text-[#c4b5fd]" },
  paused: { label: "Paused", dot: "#85858e", pill: "border-[var(--lp-border)] bg-white/[0.03] text-[var(--lp-muted)]" },
};

function monitorState(m: Monitor): MonitorState {
  return m.enabled ? m.status : "paused";
}

function monitorTarget(m: Pick<Monitor, "protocol" | "target" | "port">) {
  return m.protocol === "tcpping" && m.port ? `${m.target}:${m.port}` : m.target;
}

const protocolMeta: Record<MonitorProtocol, { label: string; short: string }> = {
  http: { label: "HTTP(S)", short: "HTTP" },
  tcpping: { label: "TCP connect", short: "TCP" },
  ping: { label: "ICMP ping", short: "ICMP" },
};

const TLS_WARN_DAYS = 14;

function daysUntil(value?: string | null) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? null : Math.floor((ts - Date.now()) / 86_400_000);
}

function intervalLabel(seconds: number) {
  return intervals.find((i) => i.seconds === seconds)?.label ?? `${Math.round(seconds / 60)} min`;
}

function relativeTime(value?: string | null, future = false) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return null;
  const seconds = Math.max(0, Math.round(((future ? ts - Date.now() : Date.now() - ts) as number) / 1000));
  const text =
    seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.round(seconds / 60)}m` : seconds < 86400 ? `${Math.round(seconds / 3600)}h` : `${Math.round(seconds / 86400)}d`;
  return future ? `in ${text}` : `${text} ago`;
}

function formatUptime(value?: number | null) {
  if (typeof value !== "number") return "—";
  return value >= 99.995 ? "100%" : `${value.toFixed(value >= 99 ? 2 : 1)}%`;
}

function fieldError(error: unknown) {
  return error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string"
    ? ((error as { message: string }).message)
    : undefined;
}

/** The last checks as a strip of bars, oldest on the left; empty slots stay faint. */
function CheckStrip({ checks }: { checks: MonitorCheck[] }) {
  const slots = Array.from({ length: RECENT_SLOTS }, (_, i) => checks[checks.length - RECENT_SLOTS + i] ?? null);
  return (
    <div className="flex h-6 items-stretch gap-[2px]" role="img" aria-label={`${checks.filter((c) => !c.ok).length} failed of the last ${checks.length} checks`}>
      {slots.map((check, i) => (
        <span
          key={i}
          title={
            check
              ? `${formatDateTime(check.checked_at)} · ${check.ok ? `${check.status_code ? `${check.status_code}, ` : ""}${check.rtt_ms?.toFixed(check.status_code ? 0 : 1) ?? "—"} ms${check.loss_percent ? `, ${check.loss_percent.toFixed(0)}% loss` : ""}` : check.error || "No replies"}`
              : undefined
          }
          className={cn(
            "min-w-0 flex-1 rounded-[2px]",
            !check ? "bg-white/[0.05]" : check.ok ? (check.loss_percent > 0 ? "bg-[#fbbf24]" : "bg-[#4ade80]/80") : "bg-[#ff3d7f]",
          )}
        />
      ))}
    </div>
  );
}

function monitorDefaults(editing: Monitor | null, email: string): MonitorFormInput {
  if (editing) {
    return {
      id: editing.id,
      name: editing.name,
      protocol: editing.protocol,
      target: editing.target,
      port: editing.port ?? 443,
      expected_status: editing.expected_status ?? undefined,
      interval_seconds: editing.interval_seconds,
      notify_email: editing.notify_email,
      enabled: editing.enabled,
    };
  }
  return { id: undefined, name: "", protocol: "http", target: "", port: 443, expected_status: undefined, interval_seconds: 300, notify_email: email, enabled: true };
}

function monitorPayload(m: Monitor, overrides: Partial<MonitorPayload> = {}): MonitorPayload {
  return {
    id: m.id,
    name: m.name,
    protocol: m.protocol,
    target: m.target,
    port: m.protocol === "tcpping" ? m.port ?? undefined : undefined,
    expected_status: m.protocol === "http" ? m.expected_status ?? undefined : undefined,
    interval_seconds: m.interval_seconds,
    notify_email: m.notify_email,
    enabled: m.enabled,
    ...overrides,
  };
}

function MonitorForm({
  editing,
  defaultEmail,
  busy,
  atLimit,
  onCancel,
  onSubmit,
}: {
  editing: Monitor | null;
  defaultEmail: string;
  busy: boolean;
  atLimit: boolean;
  onCancel: () => void;
  onSubmit: (payload: MonitorPayload) => void;
}) {
  const form = useForm<MonitorFormInput, unknown, MonitorFormValues>({
    resolver: zodResolver(monitorSchema),
    defaultValues: monitorDefaults(editing, defaultEmail),
  });
  const protocol = useWatch({ control: form.control, name: "protocol" }) ?? "http";
  const expectedStatus = useWatch({ control: form.control, name: "expected_status" });
  const interval = useWatch({ control: form.control, name: "interval_seconds" });
  const target = useWatch({ control: form.control, name: "target" });
  const port = useWatch({ control: form.control, name: "port" });
  const email = useWatch({ control: form.control, name: "notify_email" });
  const errors = form.formState.errors;

  const where = target?.trim() ? (protocol === "tcpping" && port ? `${target.trim()}:${port}` : target.trim()) : null;
  const expected = Number(expectedStatus) || null;

  return (
    <form
      className="grid gap-4"
      onSubmit={form.handleSubmit((values) =>
        onSubmit({
          id: values.id,
          name: values.name?.trim() ?? "",
          protocol: values.protocol,
          target: values.target,
          port: values.protocol === "tcpping" ? values.port : undefined,
          expected_status: values.protocol === "http" ? values.expected_status : undefined,
          interval_seconds: values.interval_seconds,
          notify_email: values.notify_email.trim(),
          enabled: values.enabled,
        }),
      )}
    >
      <div>
        <span className="mb-1.5 block text-[12px] text-[var(--lp-muted)]">Check with</span>
        <div className="grid h-9 grid-cols-3 rounded-lg border border-[var(--lp-border-strong)] bg-white/[0.03] p-1" role="radiogroup" aria-label="Check with">
          {(["http", "tcpping", "ping"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={protocol === value}
              onClick={() => form.setValue("protocol", value, { shouldValidate: form.formState.isSubmitted })}
              className={cn(
                "rounded-md text-[13px] transition-colors",
                protocol === value ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]",
              )}
            >
              {protocolMeta[value].label}
            </button>
          ))}
        </div>
      </div>

      <div className={cn("grid gap-3", protocol !== "ping" && "grid-cols-[minmax(0,1fr)_96px]")}>
        <Field label={protocol === "http" ? "URL" : "Target"} error={fieldError(errors.target)}>
          <input
            id="monitor-target"
            className="h-9 w-full px-3"
            placeholder={protocol === "http" ? "https://api.example.com/health" : "api.example.com"}
            autoComplete="off"
            {...form.register("target")}
          />
        </Field>
        {protocol === "tcpping" ? (
          <Field label="Port" error={fieldError(errors.port)}>
            <input id="monitor-port" type="number" className="h-9 w-full px-3" placeholder="443" {...form.register("port", { valueAsNumber: true })} />
          </Field>
        ) : null}
        {protocol === "http" ? (
          <Field label="Status" error={fieldError(errors.expected_status)}>
            <input id="monitor-status" type="number" className="h-9 w-full px-3" placeholder="2xx/3xx" {...form.register("expected_status", { valueAsNumber: true })} />
          </Field>
        ) : null}
      </div>

      <div>
        <span className="mb-1.5 block text-[12px] text-[var(--lp-muted)]">Check every</span>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-[var(--lp-border-strong)] bg-white/[0.03] p-1 sm:grid-cols-6" role="radiogroup" aria-label="Check every">
          {intervals.map((option) => (
            <button
              key={option.seconds}
              type="button"
              role="radio"
              aria-checked={interval === option.seconds}
              onClick={() => form.setValue("interval_seconds", option.seconds)}
              className={cn(
                "h-7 rounded-md text-[12px] transition-colors",
                interval === option.seconds ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <Field label="Email when it goes down or comes back" error={fieldError(errors.notify_email)} hint="Leave empty to only record checks.">
        <input id="monitor-email" className="h-9 w-full px-3" placeholder="ops@example.com" {...form.register("notify_email")} />
      </Field>

      <Field label="Name" hint="Optional. Defaults to the target." error={fieldError(errors.name)}>
        <input id="monitor-name" className="h-9 w-full px-3" placeholder={where ?? "Public API"} {...form.register("name")} />
      </Field>

      <Toggle label="Monitor enabled" {...form.register("enabled")} />

      <p className="rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--lp-muted)]">
        {where ? (
          <>
            Every <span className="text-[var(--lp-text)]">{intervalLabel(Number(interval) || 300)}</span>,{" "}
            {protocol === "http" ? (
              <>
                request <span className="lp-mono break-all text-[var(--lp-text)]">{where}</span>. Mark it down unless it answers with{" "}
                <span className="text-[var(--lp-text)]">{expected ?? "a 2xx or 3xx status"}</span> within 10 seconds
              </>
            ) : (
              <>
                send three {protocol === "tcpping" ? "TCP connects" : "pings"} to <span className="lp-mono text-[var(--lp-text)]">{where}</span>. If none answer, mark
                it down
              </>
            )}
            {email?.trim() ? (
              <>
                {" "}and email <span className="text-[var(--lp-text)]">{email.trim()}</span>, then again when it recovers.
              </>
            ) : (
              "."
            )}{" "}
            {protocol === "http"
              ? `HTTPS certificates get a warning ${TLS_WARN_DAYS} days before they expire.`
              : "Samples also land in History and your alert rules."}
          </>
        ) : (
          "Add a target to see what this monitor will do."
        )}
      </p>

      <div className="flex gap-2">
        <button type="submit" className="console-btn console-btn-primary h-9 flex-1" disabled={busy || (!editing && atLimit)}>
          {busy ? "Saving" : editing ? "Save changes" : atLimit ? `Limit of ${MAX_MONITORS} reached` : "Create monitor"}
        </button>
        {editing ? (
          <button type="button" className="console-btn console-btn-secondary h-9" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

function MonitorRow({
  monitor,
  editing,
  busy,
  deleting,
  onEdit,
  onToggle,
  onDelete,
}: {
  monitor: Monitor;
  editing: boolean;
  busy: boolean;
  deleting: boolean;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const state = monitorState(monitor);
  const meta = stateMeta[state];
  const checked = relativeTime(monitor.last_checked_at);
  const since = relativeTime(monitor.last_status_change_at);
  const certDays = monitor.protocol === "http" ? daysUntil(monitor.tls_expires_at) : null;

  return (
    <li className={cn("px-4 py-4 transition-colors", editing ? "bg-[rgba(255,61,127,0.05)]" : "hover:bg-white/[0.015]")}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 sm:flex-nowrap">
        <span className="relative mt-1.5 inline-flex h-2 w-2 shrink-0">
          {state === "down" ? <span className="absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none" style={{ background: meta.dot }} /> : null}
          <span className="relative h-2 w-2 rounded-full" style={{ background: meta.dot }} />
        </span>
        <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-1.25rem)]">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[14px] font-medium">{monitor.name}</h3>
            <span className={cn("rounded-md border px-1.5 py-px text-[11px]", meta.pill)}>{meta.label}</span>
            {since && (state === "up" || state === "down") ? <span className="text-[12px] text-[var(--lp-subtle)]">for {since.replace(" ago", "")}</span> : null}
          </div>
          <p className="mt-1 text-[13px] text-[var(--lp-muted)]">
            <span className="text-[var(--lp-subtle)]">{protocolMeta[monitor.protocol].short}</span>
            {monitor.name !== monitorTarget(monitor) ? (
              <>
                {" "}
                <span className="lp-mono break-all text-[var(--lp-text)]">{monitorTarget(monitor)}</span>
              </>
            ) : null}
            <span className="text-[var(--lp-subtle)]"> · every {intervalLabel(monitor.interval_seconds)}</span>
          </p>
          <div className="mt-3 grid grid-cols-1 items-center gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_auto]">
            <CheckStrip checks={monitor.recent_checks} />
            <p className="lp-mono text-[12px] text-[var(--lp-muted)] sm:text-right">
              {formatUptime(monitor.uptime_24h)} <span className="text-[var(--lp-subtle)]">24h</span>
            </p>
          </div>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-[var(--lp-subtle)]">
            {checked ? <span title={formatDateTime(monitor.last_checked_at)}>Checked {checked}</span> : <span>Not checked yet</span>}
            {state === "up" && monitor.last_status_code ? <span>{monitor.last_status_code}</span> : null}
            {state === "up" && typeof monitor.last_rtt_ms === "number" ? (
              <span>{monitor.last_rtt_ms.toFixed(monitor.protocol === "http" ? 0 : 1)} ms</span>
            ) : null}
            {certDays !== null ? (
              <span
                title={formatDateTime(monitor.tls_expires_at)}
                className={cn(certDays < 0 ? "text-[#ff8fb3]" : certDays <= TLS_WARN_DAYS && "text-[#fbbf24]")}
              >
                {certDays < 0 ? "Certificate expired" : certDays === 0 ? "Certificate expires today" : `Certificate expires in ${certDays}d`}
              </span>
            ) : null}
            {state === "down" && monitor.last_error ? <span className="max-w-full truncate text-[#ff8fb3]" title={monitor.last_error}>{monitor.last_error}</span> : null}
            {monitor.enabled ? <span title={formatDateTime(monitor.next_run_at)}>Next {relativeTime(monitor.next_run_at, true) ?? "soon"}</span> : null}
            <span>{monitor.notify_email ? `Emails ${monitor.notify_email}` : "No emails"}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 max-sm:ml-5">
          <span className="mr-1" title={monitor.enabled ? "Pause monitor" : "Resume monitor"}>
            <Toggle label="" aria-label={monitor.enabled ? `Pause ${monitor.name}` : `Resume ${monitor.name}`} checked={monitor.enabled} disabled={busy} onChange={(e) => onToggle(e.target.checked)} />
          </span>
          {confirming ? (
            <>
              <button type="button" className="console-btn h-8 bg-[rgba(255,61,127,0.15)] px-2.5 text-[#ff8fb3] hover:bg-[rgba(255,61,127,0.25)]" disabled={deleting} onClick={onDelete}>
                {deleting ? "Deleting" : "Delete"}
              </button>
              <button type="button" className="console-btn console-btn-secondary h-8 w-8 px-0" aria-label="Keep monitor" onClick={() => setConfirming(false)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="console-btn h-8 w-8 px-0 text-[var(--lp-muted)] hover:bg-white/[0.05] hover:text-[var(--lp-text)]" aria-label={`Edit ${monitor.name}`} onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="console-btn h-8 w-8 px-0 text-[var(--lp-muted)] hover:bg-[rgba(255,61,127,0.1)] hover:text-[#ff8fb3]" aria-label={`Delete ${monitor.name}`} onClick={() => setConfirming(true)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export function MonitorsWorkspace() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Monitor | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [filter, setFilter] = useState<MonitorFilter>("all");

  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => apiRequest<SessionResponse>("/api/auth/session") });
  const liveInterval = useLiveInterval(15_000);
  const monitorsQuery = useQuery({
    queryKey: ["monitors"],
    queryFn: () => apiRequest<Monitor[]>("/api/monitors"),
    refetchInterval: liveInterval,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["monitors"] });

  const save = useMutation({
    mutationFn: (payload: MonitorPayload) => apiRequest<Monitor>("/api/monitors", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: async (saved, payload) => {
      setNotice({ type: "success", message: payload.id ? `Saved ${saved.name}.` : `Monitoring ${saved.name}. The first check runs within a few seconds.` });
      setEditing(null);
      await refresh();
    },
    onError: (error: ApiError) => setNotice({ type: "error", message: error.message }),
  });

  const toggle = useMutation({
    mutationFn: ({ monitor, enabled }: { monitor: Monitor; enabled: boolean }) => {
      setBusyId(monitor.id);
      return apiRequest<Monitor>("/api/monitors", { method: "POST", body: JSON.stringify(monitorPayload(monitor, { enabled })) });
    },
    onSuccess: async (saved) => {
      setNotice({ type: "success", message: `${saved.name} ${saved.enabled ? "resumed" : "paused"}.` });
      await refresh();
    },
    onError: (error: ApiError) => setNotice({ type: "error", message: error.message }),
    onSettled: () => setBusyId(null),
  });

  const remove = useMutation({
    mutationFn: (monitor: Monitor) => {
      setDeletingId(monitor.id);
      return apiRequest<{ ok: boolean }>(`/api/monitors?id=${monitor.id}`, { method: "DELETE" });
    },
    onSuccess: async (_, monitor) => {
      setNotice({ type: "success", message: `Deleted ${monitor.name}.` });
      if (editing?.id === monitor.id) setEditing(null);
      await refresh();
    },
    onError: (error: ApiError) => setNotice({ type: "error", message: error.message }),
    onSettled: () => setDeletingId(null),
  });

  const monitors = useMemo(() => monitorsQuery.data ?? [], [monitorsQuery.data]);
  const counts = useMemo(() => {
    const c: Record<MonitorState, number> = { down: 0, up: 0, pending: 0, paused: 0 };
    monitors.forEach((m) => {
      c[monitorState(m)] += 1;
    });
    return c;
  }, [monitors]);
  const averageUptime = useMemo(() => {
    const values = monitors.filter((m) => m.enabled && typeof m.uptime_24h === "number").map((m) => m.uptime_24h as number);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }, [monitors]);
  const nextRun = useMemo(
    () => monitors.filter((m) => m.enabled).map((m) => m.next_run_at).sort()[0] ?? null,
    [monitors],
  );
  // Down first, then waiting, up, and paused.
  const visible = useMemo(() => {
    const order: Record<MonitorState, number> = { down: 0, pending: 1, up: 2, paused: 3 };
    return monitors
      .filter((m) => filter === "all" || monitorState(m) === filter)
      .sort((a, b) => order[monitorState(a)] - order[monitorState(b)] || a.name.localeCompare(b.name));
  }, [filter, monitors]);

  const loading = monitorsQuery.isLoading;
  const filters: { id: MonitorFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: monitors.length },
    { id: "down", label: "Down", count: counts.down },
    { id: "up", label: "Up", count: counts.up },
    { id: "paused", label: "Paused", count: counts.paused },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="Monitors"
        description="Websites, APIs, and servers Qnetward checks on a schedule, around the clock. When a check fails the monitor goes down and you get an email, and HTTPS certificates are watched for expiry."
        status={
          monitors.length ? (
            <RunStatus tone={counts.down ? "error" : "live"} label={counts.down ? `${counts.down} down` : "All monitors up"} />
          ) : null
        }
      />

      <StatStrip
        items={[
          { label: "Monitors", value: loading ? "—" : `${monitors.length} / ${MAX_MONITORS}` },
          { label: "Down", value: loading ? "—" : String(counts.down), tone: counts.down ? "bad" : undefined, better: "lower" },
          { label: "Up", value: loading ? "—" : String(counts.up), tone: counts.up ? "good" : undefined, better: "higher" },
          { label: "Paused", value: loading ? "—" : String(counts.paused) },
          { label: "Uptime 24h", value: formatUptime(averageUptime), better: "higher" },
          { label: "Next check", value: relativeTime(nextRun, true) ?? "—" },
        ]}
      />

      {notice ? (
        <p
          role="status"
          className={cn(
            "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-[13px]",
            notice.type === "success"
              ? "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]"
              : "border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] text-[#ff8fb3]",
          )}
        >
          {notice.message}
          <button type="button" aria-label="Dismiss" className="opacity-70 hover:opacity-100" onClick={() => setNotice(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)] [&>*]:min-w-0">
        <Panel
          title="Monitors"
          bodyClassName="p-0"
          aside={
            monitors.length ? (
              <div className="flex rounded-lg border border-[var(--lp-border)] p-0.5" role="tablist" aria-label="Filter monitors">
                {filters.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.id}
                    onClick={() => setFilter(f.id)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[12px] transition-colors",
                      filter === f.id ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]",
                    )}
                  >
                    {f.label} <span className="text-[var(--lp-subtle)]">{f.count}</span>
                  </button>
                ))}
              </div>
            ) : null
          }
        >
          {loading ? (
            <p className="px-4 pb-4 text-[13px] text-[var(--lp-subtle)]">Loading monitors…</p>
          ) : monitorsQuery.isError ? (
            <p className="mx-4 mb-4 rounded-lg border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] px-3 py-2.5 text-[13px] text-[#ff8fb3]">
              {(monitorsQuery.error as ApiError).message || "Unable to load monitors."}
            </p>
          ) : monitors.length === 0 ? (
            <div className="mx-4 mb-4 flex flex-col items-center rounded-lg border border-dashed border-[var(--lp-border)] px-6 py-12 text-center">
              <Radio className="h-5 w-5 text-[var(--lp-subtle)]" />
              <p className="mt-3 text-[13px] text-[var(--lp-muted)]">Nothing monitored yet</p>
              <p className="mt-1 max-w-sm text-[12px] text-[var(--lp-subtle)]">
                Add a website, API, or server on the right. Checks keep running when this tab is closed.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-[var(--lp-subtle)]">No {filter} monitors.</p>
          ) : (
            <ul className="divide-y divide-[var(--lp-border)] border-t border-[var(--lp-border)]">
              {visible.map((monitor) => (
                <MonitorRow
                  key={monitor.id}
                  monitor={monitor}
                  editing={editing?.id === monitor.id}
                  busy={busyId === monitor.id}
                  deleting={deletingId === monitor.id}
                  onEdit={() => {
                    setNotice(null);
                    setEditing(monitor);
                  }}
                  onToggle={(enabled) => {
                    setNotice(null);
                    toggle.mutate({ monitor, enabled });
                  }}
                  onDelete={() => {
                    setNotice(null);
                    remove.mutate(monitor);
                  }}
                />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          className="xl:sticky xl:top-20"
          title={editing ? "Edit monitor" : "New monitor"}
          aside={
            editing ? (
              <button type="button" className="inline-flex items-center gap-1 text-[12px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]" onClick={() => setEditing(null)}>
                <Plus className="h-3.5 w-3.5" /> New instead
              </button>
            ) : null
          }
        >
          {/* Remount per monitor so defaultValues land in the inputs. */}
          <MonitorForm
            key={`${editing?.id ?? "new"}:${sessionQuery.data?.user?.email ?? ""}`}
            editing={editing}
            defaultEmail={sessionQuery.data?.user?.email ?? ""}
            busy={save.isPending}
            atLimit={monitors.length >= MAX_MONITORS}
            onCancel={() => setEditing(null)}
            onSubmit={(payload) => {
              setNotice(null);
              save.mutate(payload);
            }}
          />
        </Panel>
      </div>
    </div>
  );
}
