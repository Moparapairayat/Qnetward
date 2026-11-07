"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { BellRing, Pencil, Plus, Trash2, X } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import { AlertRule, AlertRulePayload, SessionResponse } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { Field, PageHeader, Panel, RunStatus, StatStrip, Toggle } from "@/components/tools/probe-ui";
import { useLiveInterval } from "@/lib/live";

const optionalPositiveNumber = z.preprocess((value) => {
  if (value === "" || value === null || typeof value === "undefined") {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}, z.number().positive().optional());

const alertRuleSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().optional(),
  protocol: z.enum(["ping", "tcpping"]),
  target: z.string().trim().min(1, "Target is required"),
  port: optionalPositiveNumber,
  recipient_email: z.string().trim().email("Valid recipient email is required").optional(),
  latency_threshold_ms: optionalPositiveNumber,
  loss_threshold_percent: optionalPositiveNumber,
  consecutive_breaches: z.coerce.number().int().min(1).max(20),
  cooldown_minutes: z.coerce.number().int().min(1).max(1440),
  notify_on_recovery: z.boolean(),
  enabled: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.protocol === "tcpping" && (!value.port || value.port < 1 || value.port > 65535)) {
    ctx.addIssue({
      code: "custom",
      path: ["port"],
      message: "Port is required for TCP Ping rules",
    });
  }
  if (!value.latency_threshold_ms && !value.loss_threshold_percent) {
    ctx.addIssue({
      code: "custom",
      path: ["latency_threshold_ms"],
      message: "Set at least one threshold: latency or loss",
    });
  }
});

type AlertRuleFormInput = z.input<typeof alertRuleSchema>;
type AlertRuleFormValues = z.output<typeof alertRuleSchema>;
type RuleFilter = "all" | "firing" | "healthy" | "paused";

function buildAlertRuleDefaultName(protocol: AlertRulePayload["protocol"], target: string, port?: number) {
  const base = protocol === "tcpping" ? "TCP" : "ICMP";
  if (protocol === "tcpping" && port) {
    return `${base} ${target}:${port}`;
  }
  return `${base} ${target}`;
}

function ruleTarget(rule: Pick<AlertRule, "protocol" | "target" | "port">) {
  return rule.protocol === "tcpping" && rule.port ? `${rule.target}:${rule.port}` : rule.target;
}

function ruleState(rule: AlertRule): Exclude<RuleFilter, "all"> {
  if (!rule.enabled) return "paused";
  return rule.last_state === "alert" ? "firing" : "healthy";
}

const stateMeta = {
  firing: { label: "Firing", dot: "#ff3d7f", pill: "border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.1)] text-[#ff8fb3]" },
  healthy: { label: "Healthy", dot: "#4ade80", pill: "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]" },
  paused: { label: "Paused", dot: "#85858e", pill: "border-[var(--lp-border)] bg-white/[0.03] text-[var(--lp-muted)]" },
} as const;

function relativeTime(value?: string | null) {
  if (!value) return null;
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return null;
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function conditionText(latency?: number | null, loss?: number | null) {
  const parts: string[] = [];
  if (typeof latency === "number" && latency > 0) parts.push(`latency ≥ ${latency}ms`);
  if (typeof loss === "number" && loss > 0) parts.push(`loss ≥ ${loss}%`);
  return parts.join(" or ");
}

function fieldErrorText(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) {
    return null;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

function alertRuleDefaults(editingRule: AlertRule | null, defaultRecipientEmail: string): AlertRuleFormInput {
  if (editingRule) {
    return {
      id: editingRule.id,
      name: editingRule.name || "",
      protocol: editingRule.protocol,
      target: editingRule.target,
      port: editingRule.port ?? undefined,
      recipient_email: editingRule.recipient_email || defaultRecipientEmail,
      latency_threshold_ms: editingRule.latency_threshold_ms ?? undefined,
      loss_threshold_percent: editingRule.loss_threshold_percent ?? undefined,
      consecutive_breaches: editingRule.consecutive_breaches,
      cooldown_minutes: editingRule.cooldown_minutes,
      notify_on_recovery: editingRule.notify_on_recovery,
      enabled: editingRule.enabled,
    };
  }

  return {
    id: undefined,
    name: "",
    protocol: "ping",
    target: "",
    port: 443,
    recipient_email: defaultRecipientEmail,
    latency_threshold_ms: undefined,
    loss_threshold_percent: undefined,
    consecutive_breaches: 1,
    cooldown_minutes: 30,
    notify_on_recovery: true,
    enabled: true,
  };
}

function rulePayload(rule: AlertRule, overrides: Partial<AlertRulePayload> = {}): AlertRulePayload {
  return {
    id: rule.id,
    name: rule.name,
    protocol: rule.protocol,
    target: rule.target,
    port: rule.protocol === "tcpping" ? rule.port ?? undefined : undefined,
    recipient_email: rule.recipient_email,
    latency_threshold_ms: rule.latency_threshold_ms ?? undefined,
    loss_threshold_percent: rule.loss_threshold_percent ?? undefined,
    consecutive_breaches: rule.consecutive_breaches,
    cooldown_minutes: rule.cooldown_minutes,
    notify_on_recovery: rule.notify_on_recovery,
    enabled: rule.enabled,
    ...overrides,
  };
}

function AlertRuleForm({
  editingRule,
  defaultRecipientEmail,
  isBusy,
  onCancelEdit,
  onSubmitRule,
}: {
  editingRule: AlertRule | null;
  defaultRecipientEmail: string;
  isBusy: boolean;
  onCancelEdit: () => void;
  onSubmitRule: (payload: AlertRulePayload) => void;
}) {
  const form = useForm<AlertRuleFormInput, unknown, AlertRuleFormValues>({
    resolver: zodResolver(alertRuleSchema),
    defaultValues: alertRuleDefaults(editingRule, defaultRecipientEmail),
  });

  const watched = useWatch({ control: form.control });
  const notifyOnRecovery = useWatch({ control: form.control, name: "notify_on_recovery" });
  const protocol = watched.protocol ?? "ping";
  const errors = form.formState.errors;

  // Plain-language read-back of the rule as it is being typed.
  const preview = useMemo(() => {
    const target = watched.target?.trim();
    const condition = conditionText(Number(watched.latency_threshold_ms) || null, Number(watched.loss_threshold_percent) || null);
    if (!target || !condition) return null;
    const where = protocol === "tcpping" && watched.port ? `${target}:${watched.port}` : target;
    const breaches = Number(watched.consecutive_breaches) || 1;
    const who = watched.recipient_email?.trim() || defaultRecipientEmail || "the recipient";
    return { who, where, condition, breaches, cooldown: Number(watched.cooldown_minutes) || 30, recovery: notifyOnRecovery === true };
  }, [defaultRecipientEmail, notifyOnRecovery, protocol, watched]);

  return (
    <form
      className="grid gap-4"
      onSubmit={form.handleSubmit((values) => {
        onSubmitRule({
          id: values.id,
          name: values.name?.trim() || buildAlertRuleDefaultName(values.protocol, values.target, values.port),
          protocol: values.protocol,
          target: values.target,
          port: values.protocol === "tcpping" ? values.port : undefined,
          recipient_email: values.recipient_email?.trim() || defaultRecipientEmail,
          latency_threshold_ms: values.latency_threshold_ms,
          loss_threshold_percent: values.loss_threshold_percent,
          consecutive_breaches: values.consecutive_breaches,
          cooldown_minutes: values.cooldown_minutes,
          notify_on_recovery: values.notify_on_recovery,
          enabled: values.enabled,
        });
      })}
    >
      <div>
        <span className="mb-1.5 block text-[12px] text-[var(--lp-muted)]">Protocol</span>
        <div className="grid h-9 grid-cols-2 rounded-lg border border-[var(--lp-border-strong)] bg-white/[0.03] p-1" role="radiogroup" aria-label="Protocol">
          {(["ping", "tcpping"] as const).map((value) => (
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
              {value === "ping" ? "ICMP ping" : "TCP ping"}
            </button>
          ))}
        </div>
      </div>

      <div className={cn("grid gap-3", protocol === "tcpping" && "grid-cols-[minmax(0,1fr)_96px]")}>
        <Field label="Target" error={fieldErrorText(errors.target) ?? undefined}>
          <input id="alert-target" className="h-9 w-full px-3" placeholder="example.com or 8.8.8.8" autoComplete="off" {...form.register("target")} />
        </Field>
        {protocol === "tcpping" ? (
          <Field label="Port" error={fieldErrorText(errors.port) ?? undefined}>
            <input id="alert-port" type="number" className="h-9 w-full px-3" placeholder="443" {...form.register("port", { valueAsNumber: true })} />
          </Field>
        ) : null}
      </div>

      <div>
        <span className="mb-1.5 block text-[12px] text-[var(--lp-muted)]">Fire when</span>
        <div className="grid grid-cols-2 gap-3">
          <label className="relative block">
            <span className="sr-only">Latency threshold in milliseconds</span>
            <input id="alert-latency" type="number" className="h-9 w-full pl-3 pr-16" placeholder="200" {...form.register("latency_threshold_ms", { valueAsNumber: true })} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[var(--lp-subtle)]">ms latency</span>
          </label>
          <label className="relative block">
            <span className="sr-only">Loss threshold in percent</span>
            <input id="alert-loss" type="number" className="h-9 w-full pl-3 pr-12" placeholder="25" {...form.register("loss_threshold_percent", { valueAsNumber: true })} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[var(--lp-subtle)]">% loss</span>
          </label>
        </div>
        <span className={cn("mt-1 block text-[12px]", errors.latency_threshold_ms ? "text-[#ff8fb3]" : "text-[var(--lp-subtle)]")}>
          {fieldErrorText(errors.latency_threshold_ms) ?? "Either one is enough. Leave a field empty to ignore it."}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Runs in a row" hint="1 to 20">
          <input id="alert-breaches" type="number" className="h-9 w-full px-3" {...form.register("consecutive_breaches", { valueAsNumber: true })} />
        </Field>
        <Field label="Cooldown (minutes)" hint="Quiet time between emails">
          <input id="alert-cooldown" type="number" className="h-9 w-full px-3" {...form.register("cooldown_minutes", { valueAsNumber: true })} />
        </Field>
      </div>

      <Field label="Send to" error={fieldErrorText(errors.recipient_email) ?? undefined}>
        <input id="alert-email" className="h-9 w-full px-3" placeholder="ops@example.com" {...form.register("recipient_email")} />
      </Field>

      <Field label="Name" hint="Optional. Defaults to the protocol and target.">
        <input id="alert-name" className="h-9 w-full px-3" placeholder={buildAlertRuleDefaultName(protocol, watched.target?.trim() || "example.com", watched.port ? Number(watched.port) : undefined)} {...form.register("name")} />
      </Field>

      <div className="grid gap-2.5">
        <Toggle label="Email when it recovers" {...form.register("notify_on_recovery")} />
        <Toggle label="Rule enabled" {...form.register("enabled")} />
      </div>

      <div className="rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2.5 text-[12px] leading-relaxed text-[var(--lp-muted)]">
        {preview ? (
          <>
            Email <span className="text-[var(--lp-text)]">{preview.who}</span> when{" "}
            <span className="lp-mono text-[var(--lp-text)]">{preview.where}</span> has <span className="text-[var(--lp-text)]">{preview.condition}</span>
            {preview.breaches > 1 ? ` for ${preview.breaches} runs in a row` : " on any run"}, at most once every {preview.cooldown} minutes
            {preview.recovery ? ", and again when it recovers." : "."}
          </>
        ) : (
          "Add a target and a threshold to see what this rule will do."
        )}
      </div>

      <div className="flex gap-2">
        <button type="submit" className="console-btn console-btn-primary h-9 flex-1" disabled={isBusy}>
          {isBusy ? "Saving" : editingRule ? "Save changes" : "Create rule"}
        </button>
        {editingRule ? (
          <button type="button" className="console-btn console-btn-secondary h-9" onClick={onCancelEdit} disabled={isBusy}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

function RuleRow({
  rule,
  editing,
  busy,
  deleting,
  onEdit,
  onToggle,
  onDelete,
}: {
  rule: AlertRule;
  editing: boolean;
  busy: boolean;
  deleting: boolean;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const state = ruleState(rule);
  const meta = stateMeta[state];
  const triggered = relativeTime(rule.last_triggered_at);
  const recovered = relativeTime(rule.last_recovered_at);
  const evaluated = relativeTime(rule.last_evaluated_at);

  return (
    <li className={cn("px-4 py-4 transition-colors", editing ? "bg-[rgba(255,61,127,0.05)]" : "hover:bg-white/[0.015]")}>
      {/* On phones the actions wrap to their own row so the rule text gets the full width. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 sm:flex-nowrap">
        <span className="relative mt-1.5 inline-flex h-2 w-2 shrink-0">
          {state === "firing" ? <span className="absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none" style={{ background: meta.dot }} /> : null}
          <span className="relative h-2 w-2 rounded-full" style={{ background: meta.dot }} />
        </span>
        <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-1.25rem)]">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[14px] font-medium">{rule.name || buildAlertRuleDefaultName(rule.protocol, rule.target, rule.port ?? undefined)}</h3>
            <span className={cn("rounded-md border px-1.5 py-px text-[11px]", meta.pill)}>{meta.label}</span>
            {state === "firing" && rule.current_breach_streak > 0 ? (
              <span className="text-[12px] text-[#ff8fb3]">{rule.current_breach_streak} breach{rule.current_breach_streak === 1 ? "" : "es"} in a row</span>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] text-[var(--lp-muted)]">
            <span className="text-[var(--lp-subtle)]">{rule.protocol === "tcpping" ? "TCP" : "ICMP"}</span>{" "}
            <span className="lp-mono text-[var(--lp-text)]">{ruleTarget(rule)}</span>
            <span className="text-[var(--lp-subtle)]"> · </span>
            {conditionText(rule.latency_threshold_ms, rule.loss_threshold_percent).replace(/^./, (c) => c.toUpperCase())}
            {rule.consecutive_breaches > 1 ? <span className="text-[var(--lp-subtle)]"> · {rule.consecutive_breaches} runs in a row</span> : null}
          </p>
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-[var(--lp-subtle)]">
            <span>To {rule.recipient_email}</span>
            <span>{rule.cooldown_minutes}m cooldown</span>
            <span>{rule.notify_on_recovery ? "Recovery email on" : "Recovery email off"}</span>
            <span title={rule.last_triggered_at ? formatDateTime(rule.last_triggered_at) : undefined}>{triggered ? `Fired ${triggered}` : "Never fired"}</span>
            {recovered ? <span title={formatDateTime(rule.last_recovered_at)}>Recovered {recovered}</span> : null}
            {evaluated ? <span title={formatDateTime(rule.last_evaluated_at)}>Checked {evaluated}</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 max-sm:ml-5">
          <span className="mr-1" title={rule.enabled ? "Pause rule" : "Resume rule"}>
            <Toggle label="" aria-label={rule.enabled ? `Pause ${rule.name}` : `Resume ${rule.name}`} checked={rule.enabled} disabled={busy} onChange={(e) => onToggle(e.target.checked)} />
          </span>
          {confirming ? (
            <>
              <button type="button" className="console-btn h-8 bg-[rgba(255,61,127,0.15)] px-2.5 text-[#ff8fb3] hover:bg-[rgba(255,61,127,0.25)]" disabled={deleting} onClick={onDelete}>
                {deleting ? "Deleting" : "Delete"}
              </button>
              <button type="button" className="console-btn console-btn-secondary h-8 w-8 px-0" aria-label="Keep rule" onClick={() => setConfirming(false)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button type="button" className="console-btn h-8 w-8 px-0 text-[var(--lp-muted)] hover:bg-white/[0.05] hover:text-[var(--lp-text)]" aria-label={`Edit ${rule.name}`} onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button type="button" className="console-btn h-8 w-8 px-0 text-[var(--lp-muted)] hover:bg-[rgba(255,61,127,0.1)] hover:text-[#ff8fb3]" aria-label={`Delete ${rule.name}`} onClick={() => setConfirming(true)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export function AlertRulesWorkspace() {
  const queryClient = useQueryClient();
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<number | null>(null);
  const [togglingRuleId, setTogglingRuleId] = useState<number | null>(null);
  const [filter, setFilter] = useState<RuleFilter>("all");

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: () => apiRequest<SessionResponse>("/api/auth/session"),
  });

  const liveInterval = useLiveInterval(15_000);
  const alertRulesQuery = useQuery({
    queryKey: ["alert-rules"],
    queryFn: () => apiRequest<AlertRule[]>("/api/alerts/rules"),
    refetchInterval: liveInterval,
  });

  const saveAlertRuleMutation = useMutation({
    mutationFn: (payload: AlertRulePayload) =>
      apiRequest<AlertRule>("/api/alerts/rules", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: async (savedRule, payload) => {
      setNotice({
        type: "success",
        message: payload.id ? `Saved changes to ${savedRule.name || savedRule.target}.` : `Created a rule for ${savedRule.target}.`,
      });
      setEditingRule(null);
      await queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
    },
    onError: (error: ApiError) => {
      setNotice({ type: "error", message: error.message });
    },
  });

  const toggleRuleMutation = useMutation({
    mutationFn: ({ rule, enabled }: { rule: AlertRule; enabled: boolean }) => {
      setTogglingRuleId(rule.id);
      return apiRequest<AlertRule>("/api/alerts/rules", {
        method: "POST",
        body: JSON.stringify(rulePayload(rule, { enabled })),
      });
    },
    onSuccess: async (savedRule) => {
      setNotice({ type: "success", message: `${savedRule.name || savedRule.target} ${savedRule.enabled ? "resumed" : "paused"}.` });
      await queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
    },
    onError: (error: ApiError) => {
      setNotice({ type: "error", message: error.message });
    },
    onSettled: () => {
      setTogglingRuleId(null);
    },
  });

  const deleteAlertRuleMutation = useMutation({
    mutationFn: async (rule: AlertRule) => {
      setDeletingRuleId(rule.id);
      return apiRequest<{ ok: boolean; id: number }>(`/api/alerts/rules?id=${encodeURIComponent(String(rule.id))}`, {
        method: "DELETE",
      });
    },
    onSuccess: async (_, rule) => {
      setNotice({ type: "success", message: `Deleted ${rule.name || rule.target}.` });
      if (editingRule?.id === rule.id) {
        setEditingRule(null);
      }
      await queryClient.invalidateQueries({ queryKey: ["alert-rules"] });
    },
    onError: (error: ApiError) => {
      setNotice({ type: "error", message: error.message });
    },
    onSettled: () => {
      setDeletingRuleId(null);
    },
  });

  const rules = useMemo(() => alertRulesQuery.data ?? [], [alertRulesQuery.data]);
  const counts = useMemo(() => {
    const byState = { firing: 0, healthy: 0, paused: 0 };
    rules.forEach((rule) => {
      byState[ruleState(rule)] += 1;
    });
    return byState;
  }, [rules]);
  const lastFiredAt = useMemo(
    () => rules.map((rule) => rule.last_triggered_at).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null,
    [rules],
  );
  // Firing rules first, then healthy, then paused; newest first within each group.
  const visibleRules = useMemo(() => {
    const order = { firing: 0, healthy: 1, paused: 2 };
    return rules
      .filter((rule) => filter === "all" || ruleState(rule) === filter)
      .sort((a, b) => order[ruleState(a)] - order[ruleState(b)] || b.id - a.id);
  }, [filter, rules]);

  const filters: { id: RuleFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: rules.length },
    { id: "firing", label: "Firing", count: counts.firing },
    { id: "healthy", label: "Healthy", count: counts.healthy },
    { id: "paused", label: "Paused", count: counts.paused },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="Alert rules"
        description="Latency and loss thresholds checked after every ICMP and TCP ping, whether you run it or a monitor does. Breaches send an email, with a cooldown so one incident is one message."
        status={
          rules.length ? (
            <RunStatus tone={counts.firing ? "error" : "live"} label={counts.firing ? `${counts.firing} firing` : "All clear"} />
          ) : null
        }
      />

      <StatStrip
        items={[
          { label: "Rules", value: alertRulesQuery.isLoading ? "—" : String(rules.length) },
          { label: "Firing", value: alertRulesQuery.isLoading ? "—" : String(counts.firing), tone: counts.firing ? "bad" : undefined, better: "lower" },
          { label: "Healthy", value: alertRulesQuery.isLoading ? "—" : String(counts.healthy), tone: counts.healthy ? "good" : undefined, better: "higher" },
          { label: "Paused", value: alertRulesQuery.isLoading ? "—" : String(counts.paused) },
          { label: "Last fired", value: relativeTime(lastFiredAt) ?? "—" },
          { label: "Recipients", value: rules.length ? String(new Set(rules.map((rule) => rule.recipient_email)).size) : "—" },
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
          title="Rules"
          bodyClassName="p-0"
          aside={
            rules.length ? (
              <div className="flex rounded-lg border border-[var(--lp-border)] p-0.5" role="tablist" aria-label="Filter rules">
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
          {alertRulesQuery.isLoading ? (
            <p className="px-4 pb-4 text-[13px] text-[var(--lp-subtle)]">Loading rules…</p>
          ) : alertRulesQuery.isError ? (
            <p className="mx-4 mb-4 rounded-lg border border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] px-3 py-2.5 text-[13px] text-[#ff8fb3]">
              {(alertRulesQuery.error as ApiError).message || "Unable to load alert rules."}
            </p>
          ) : rules.length === 0 ? (
            <div className="mx-4 mb-4 flex flex-col items-center rounded-lg border border-dashed border-[var(--lp-border)] px-6 py-12 text-center">
              <BellRing className="h-5 w-5 text-[var(--lp-subtle)]" />
              <p className="mt-3 text-[13px] text-[var(--lp-muted)]">No alert rules yet</p>
              <p className="mt-1 max-w-sm text-[12px] text-[var(--lp-subtle)]">Create one on the right. It is checked after every ping or TCP ping against the same target, including scheduled monitor checks.</p>
            </div>
          ) : visibleRules.length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-[var(--lp-subtle)]">No {filter} rules.</p>
          ) : (
            <ul className="divide-y divide-[var(--lp-border)] border-t border-[var(--lp-border)]">
              {visibleRules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  editing={editingRule?.id === rule.id}
                  busy={togglingRuleId === rule.id}
                  deleting={deletingRuleId === rule.id}
                  onEdit={() => {
                    setNotice(null);
                    setEditingRule(rule);
                  }}
                  onToggle={(enabled) => {
                    setNotice(null);
                    toggleRuleMutation.mutate({ rule, enabled });
                  }}
                  onDelete={() => {
                    setNotice(null);
                    deleteAlertRuleMutation.mutate(rule);
                  }}
                />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          className="xl:sticky xl:top-20"
          title={editingRule ? "Edit rule" : "New rule"}
          aside={
            editingRule ? (
              <button type="button" className="inline-flex items-center gap-1 text-[12px] text-[var(--lp-muted)] hover:text-[var(--lp-text)]" onClick={() => setEditingRule(null)}>
                <Plus className="h-3.5 w-3.5" /> New instead
              </button>
            ) : null
          }
        >
          {/* Remount per rule so defaultValues land in the inputs; reset() left the uncontrolled fields stale. */}
          <AlertRuleForm
            key={`${editingRule?.id ?? "new"}:${sessionQuery.data?.user?.email ?? ""}`}
            editingRule={editingRule}
            defaultRecipientEmail={sessionQuery.data?.user?.email ?? ""}
            isBusy={saveAlertRuleMutation.isPending}
            onCancelEdit={() => setEditingRule(null)}
            onSubmitRule={(payload) => {
              setNotice(null);
              saveAlertRuleMutation.mutate(payload);
            }}
          />
        </Panel>
      </div>
    </div>
  );
}
