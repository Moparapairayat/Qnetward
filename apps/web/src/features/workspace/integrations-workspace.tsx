"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Copy, Pencil, Plus, Send, Trash2, Webhook, XCircle } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type {
  ChannelEvent,
  ChannelKind,
  ChannelListResponse,
  ChannelSaveResponse,
  ChannelTestResponse,
  NotificationChannel,
  SessionResponse,
  WorkspaceTeamResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate, Notice, SettingsCard, SettingsPageTitle } from "@/components/settings/settings-ui";
import { Modal } from "@/components/ui/modal";
import { Stepper } from "@/components/ui/stepper";
import { DiscordLogo, SlackLogo, TelegramLogo } from "@/components/brand-logos";

// Brand kinds show their own logo on a neutral tile; the generic webhook gets a tinted icon.
const kinds: Record<ChannelKind, { label: string; icon: ComponentType<{ className?: string }>; brand: boolean; tint: string; blurb: string; help: ReactNode }> = {
  slack: {
    label: "Slack",
    icon: SlackLogo,
    brand: true,
    tint: "#e01e5a",
    blurb: "Post to a channel through an incoming webhook",
    help: (
      <>
        In Slack, open <b>Apps</b>, add <b>Incoming Webhooks</b>, pick the channel, and copy the webhook URL.
      </>
    ),
  },
  discord: {
    label: "Discord",
    icon: DiscordLogo,
    brand: true,
    tint: "#5865f2",
    blurb: "Post to a server channel through a webhook",
    help: (
      <>
        In Discord, open the channel&apos;s <b>Edit channel → Integrations → Webhooks</b>, create one, and copy its URL.
      </>
    ),
  },
  telegram: {
    label: "Telegram",
    icon: TelegramLogo,
    brand: true,
    tint: "#2aabee",
    blurb: "Message a chat or group from your own bot",
    help: (
      <>
        Create a bot with <b>@BotFather</b> and copy its token. Add the bot to your group, then use the group&apos;s chat ID, which starts with -100.
      </>
    ),
  },
  webhook: {
    label: "Webhook",
    icon: Webhook,
    brand: false,
    tint: "#a78bfa",
    blurb: "POST signed JSON to your own endpoint",
    help: <>Qnetward sends a JSON POST for each alert, signed with a secret you get after saving, so your endpoint can check it came from us.</>,
  },
};

const eventInfo: Record<ChannelEvent, { label: string; detail: string }> = {
  monitors: { label: "Monitors", detail: "When a monitor goes down, and when it comes back up" },
  certificates: { label: "Certificates", detail: "When an HTTPS monitor's certificate is 14 days from expiring" },
  alert_rules: { label: "Alert rules", detail: "When a latency or packet loss rule fires or clears" },
  agents: { label: "Probe agents", detail: "When an agent running your monitors goes offline, and when it's back" },
  security: { label: "Security checks", detail: "When a watched domain's grade drops or a new high-severity issue appears" },
  hosts: { label: "Hosts", detail: "When a host's CPU, memory, disk, or swap stays high, and when it recovers" },
};
const allEvents = Object.keys(eventInfo) as ChannelEvent[];

function relative(value?: string | null) {
  if (!value) return null;
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDate(value);
}

function KindBadge({ kind, size = "md" }: { kind: ChannelKind; size?: "md" | "lg" }) {
  const meta = kinds[kind];
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-lg border",
        size === "lg" ? "h-10 w-10" : "h-8 w-8",
        meta.brand && "border-[var(--lp-border-strong)] bg-white/[0.04]",
      )}
      style={meta.brand ? undefined : { borderColor: `${meta.tint}55`, background: `${meta.tint}1f`, color: meta.tint }}
      aria-hidden="true"
    >
      <meta.icon className={meta.brand ? (size === "lg" ? "h-5 w-5" : "h-[18px] w-[18px]") : size === "lg" ? "h-[18px] w-[18px]" : "h-4 w-4"} />
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-[var(--lp-muted)]">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs leading-relaxed text-[var(--lp-subtle)]">{hint}</span> : null}
    </label>
  );
}

/** The same checks the server makes, so a bad paste shows up before the last step. */
function destinationProblem(kind: ChannelKind, url: string, token: string, chatId: string): string | null {
  const u = url.trim();
  if (kind === "slack" && u && !u.startsWith("https://hooks.slack.com/services/")) return "Slack webhook URLs start with https://hooks.slack.com/services/";
  if (kind === "discord" && u && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(u)) return "Discord webhook URLs start with https://discord.com/api/webhooks/";
  if (kind === "webhook" && u && !/^https?:\/\/[^/\s]+/.test(u)) return "The URL must start with https:// or http://";
  if (kind === "telegram" && token.trim() && !/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token.trim())) return "A bot token looks like 123456789:AAE…, as @BotFather gives it";
  if (kind === "telegram" && chatId.trim() && !/^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/.test(chatId.trim())) return "A chat ID is a number such as -1001234567890, or @channelname";
  return null;
}

const defaultName = (k: ChannelKind) => (k === "webhook" ? "Webhook" : `${kinds[k].label} alerts`);

const CREATE_STEPS = ["Type", "Connect", "Alerts", "Test"] as const;
const EDIT_STEPS = ["Connect", "Alerts"] as const;

/**
 * Adding a channel in four steps: pick a tool, paste where it posts, choose
 * which alerts it gets, then send a test. Editing skips the first and last.
 */
function ChannelDialog({ open, onClose, editing, initialKind }: { open: boolean; onClose: () => void; editing: NotificationChannel | null; initialKind: ChannelKind | null }) {
  const queryClient = useQueryClient();
  const steps = editing ? EDIT_STEPS : CREATE_STEPS;
  // Steps are numbered as in CREATE_STEPS; editing starts at Connect.
  const [step, setStep] = useState(editing ? 1 : initialKind ? 1 : 0);
  const [kind, setKind] = useState<ChannelKind | null>(editing?.kind ?? initialKind);
  const [name, setName] = useState(editing?.name ?? (initialKind ? defaultName(initialKind) : ""));
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [events, setEvents] = useState<ChannelEvent[]>(editing?.events ?? allEvents);
  const [saved, setSaved] = useState<ChannelSaveResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      apiRequest<ChannelSaveResponse>("/api/workspace/channels", {
        method: "POST",
        body: JSON.stringify({ id: editing?.id, kind, name: name.trim(), url, token, chat_id: chatId, events, enabled: editing?.enabled ?? true }),
      }),
    onSuccess: async (resp) => {
      await queryClient.invalidateQueries({ queryKey: ["workspace-channels"] });
      if (editing) onClose();
      else {
        setSaved(resp);
        setStep(3);
      }
    },
  });
  const test = useMutation({
    mutationFn: (id: number) => apiRequest<ChannelTestResponse>("/api/workspace/channels/test", { method: "POST", body: JSON.stringify({ id }) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["workspace-channels"] }),
  });

  const destinationFilled = kind === "telegram" ? token.trim() !== "" && chatId.trim() !== "" : url.trim() !== "";
  const problem = kind ? destinationProblem(kind, url, token, chatId) : null;
  const canContinue =
    step === 0 ? kind !== null : step === 1 ? name.trim() !== "" && !problem && (editing !== null || destinationFilled) : step === 2 ? events.length > 0 : true;
  const lastFormStep = 2;
  const meta = kind ? kinds[kind] : null;

  const next = () => {
    if (!canContinue) return;
    if (step === lastFormStep) save.mutate();
    else setStep((s) => s + 1);
  };
  const pickKind = (k: ChannelKind) => {
    setKind(k);
    // Keep a name the person typed; replace one we filled in for another type.
    if (!name || (kind && name === defaultName(kind))) setName(defaultName(k));
    setStep(1);
  };

  const shownStep = editing ? step - 1 : step;
  const secretPending = Boolean(saved?.signing_secret) && !copied;

  const footer =
    step === 3 ? (
      <button type="button" className="console-btn console-btn-primary" onClick={onClose}>
        {secretPending ? "I've saved the secret" : "Done"}
      </button>
    ) : (
      <>
        {save.isError ? <span className="mr-auto text-xs text-[#ff8fb3]">{(save.error as ApiError).message}</span> : null}
        {step > (editing ? 1 : 0) ? (
          <button type="button" className="console-btn console-btn-secondary" disabled={save.isPending} onClick={() => setStep((s) => s - 1)}>
            Back
          </button>
        ) : (
          <button type="button" className="console-btn console-btn-secondary" onClick={onClose}>
            Cancel
          </button>
        )}
        {step > 0 ? (
          <button type="submit" form="channel-form" className="console-btn console-btn-primary" disabled={!canContinue || save.isPending}>
            {step === lastFormStep ? (save.isPending ? "Saving" : editing ? "Save changes" : "Add channel") : "Continue"}
          </button>
        ) : null}
      </>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!secretPending}
      title={step === 3 ? `${saved?.channel.name ?? "Channel"} is ready` : editing ? `Edit ${editing.name}` : "Add an alert channel"}
      description={step === 3 ? "Send a test to make sure it arrives." : "Alerts go here as well as to the email set on each monitor."}
      footer={footer}
    >
      <Stepper steps={steps} step={shownStep} />
      <form
        id="channel-form"
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        {step === 0 ? (
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Channel type">
            {(Object.keys(kinds) as ChannelKind[]).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => pickKind(k)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                  kind === k ? "border-[rgba(255,61,127,0.45)] bg-[rgba(255,61,127,0.06)]" : "border-[var(--lp-border)] hover:bg-white/[0.03]",
                )}
              >
                <KindBadge kind={k} />
                <span className="min-w-0">
                  <span className="block text-base font-medium">{kinds[k].label}</span>
                  <span className="block text-xs leading-snug text-[var(--lp-subtle)]">{kinds[k].blurb}</span>
                </span>
              </button>
            ))}
          </div>
        ) : step === 1 && meta && kind ? (
          <div className="grid gap-5">
            <div className="flex items-start gap-3 rounded-lg border border-[var(--lp-border)] bg-black/20 p-3">
              <KindBadge kind={kind} />
              <p className="text-xs leading-relaxed text-[var(--lp-muted)]">{meta.help}</p>
            </div>
            <Field label="Name" hint="Shown in this list, and in the audit log.">
              <input className="h-9 w-full px-3" maxLength={80} autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            {kind === "telegram" ? (
              <>
                <Field label="Bot token" hint={editing ? "Leave blank to keep the current token." : undefined}>
                  <input
                    className="lp-mono h-9 w-full px-3 text-sm"
                    placeholder={editing ? "••••••••" : "123456789:AAE…"}
                    autoComplete="off"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </Field>
                <Field label="Chat ID" hint={editing ? `Leave blank to keep ${editing.target}.` : "A number such as -1001234567890, or @channelname for a public channel."}>
                  <input className="lp-mono h-9 w-full px-3 text-sm" placeholder="-1001234567890" autoComplete="off" value={chatId} onChange={(e) => setChatId(e.target.value)} />
                </Field>
              </>
            ) : (
              <Field label={kind === "webhook" ? "Endpoint URL" : "Webhook URL"} hint={editing ? `Leave blank to keep the current URL (${editing.target}).` : "Stored encrypted. Only the last few characters are shown afterwards."}>
                <input
                  className="lp-mono h-9 w-full px-3 text-sm"
                  placeholder={
                    kind === "slack" ? "https://hooks.slack.com/services/…" : kind === "discord" ? "https://discord.com/api/webhooks/…" : "https://example.com/hooks/qnetward"
                  }
                  autoComplete="off"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </Field>
            )}
            {problem ? <p className="-mt-3 text-xs text-[#ff8fb3]">{problem}</p> : null}
          </div>
        ) : step === 2 ? (
          <fieldset>
            <legend className="mb-2 text-sm text-[var(--lp-muted)]">Which alerts should go here?</legend>
            <div className="grid gap-2">
              {allEvents.map((ev) => {
                const on = events.includes(ev);
                return (
                  <label
                    key={ev}
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-lg border px-3.5 py-3 transition-colors",
                      on ? "border-[rgba(255,61,127,0.45)] bg-[rgba(255,61,127,0.06)]" : "border-[var(--lp-border)] hover:bg-white/[0.02]",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-[var(--lp-accent)]"
                      checked={on}
                      onChange={() => setEvents((cur) => (cur.includes(ev) ? cur.filter((e) => e !== ev) : [...cur, ev]))}
                    />
                    <span>
                      <span className="block text-base">{eventInfo[ev].label}</span>
                      <span className="block text-sm leading-snug text-[var(--lp-subtle)]">{eventInfo[ev].detail}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {events.length === 0 ? <p className="mt-2 text-xs text-[#ff8fb3]">Choose at least one.</p> : null}
          </fieldset>
        ) : saved ? (
          <div className="grid min-w-0 grid-cols-1 gap-4 [&>*]:min-w-0">
            <div className="flex items-center gap-3 rounded-lg border border-[var(--lp-border)] p-3">
              <KindBadge kind={saved.channel.kind} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium">{saved.channel.name}</p>
                <p className="lp-mono truncate text-xs text-[var(--lp-subtle)]">{saved.channel.target}</p>
              </div>
              <button type="button" className="console-btn console-btn-secondary shrink-0" disabled={test.isPending} onClick={() => test.mutate(saved.channel.id)}>
                <Send className="h-3.5 w-3.5" /> {test.isPending ? "Sending…" : test.data ? "Send again" : "Send test"}
              </button>
            </div>
            {test.data ? (
              test.data.ok ? (
                <Notice tone="success">Delivered. Check {kinds[saved.channel.kind].label} for the test message.</Notice>
              ) : (
                <Notice tone="error">It didn&apos;t go through: {test.data.error}</Notice>
              )
            ) : test.isError ? (
              <Notice tone="error">{(test.error as ApiError).message}</Notice>
            ) : null}

            {saved.signing_secret ? (
              <div className="grid min-w-0 grid-cols-1 gap-2">
                <p className="text-sm text-[var(--lp-muted)]">Signing secret, shown once</p>
                <div className="flex gap-2">
                  <code className="lp-mono flex h-10 min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap rounded-md border border-[var(--lp-border-strong)] bg-black/30 px-3 text-sm">
                    {saved.signing_secret}
                  </code>
                  <button
                    type="button"
                    className="console-btn console-btn-secondary h-10 shrink-0"
                    onClick={() => {
                      void navigator.clipboard?.writeText(saved.signing_secret ?? "").then(() => setCopied(true));
                    }}
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-[var(--lp-green)]" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <p className="text-xs leading-relaxed text-[var(--lp-subtle)]">
                  Each request carries <code className="lp-mono text-[var(--lp-muted)]">X-Qnetward-Timestamp</code> and{" "}
                  <code className="lp-mono text-[var(--lp-muted)]">X-Qnetward-Signature: sha256=…</code>, the HMAC-SHA256 of the timestamp, a dot, and the raw body.
                  Reject requests whose signature doesn&apos;t match.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

function ChannelRow({ channel, canManage, onEdit }: { channel: NotificationChannel; canManage: boolean; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["workspace-channels"] });
  const toggle = useMutation({
    mutationFn: () =>
      apiRequest("/api/workspace/channels", {
        method: "POST",
        body: JSON.stringify({ id: channel.id, kind: channel.kind, name: channel.name, events: channel.events, enabled: !channel.enabled }),
      }),
    onSettled: refresh,
  });
  const test = useMutation({
    mutationFn: () => apiRequest<ChannelTestResponse>("/api/workspace/channels/test", { method: "POST", body: JSON.stringify({ id: channel.id }) }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: () => apiRequest(`/api/workspace/channels?id=${channel.id}`, { method: "DELETE" }),
    onSettled: refresh,
  });

  const failing = Boolean(channel.last_error);
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <KindBadge kind={channel.kind} />
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-base font-medium">
            <span className="truncate">{channel.name}</span>
            {!channel.enabled ? <span className="rounded border border-[var(--lp-border-strong)] px-1.5 text-2xs font-normal text-[var(--lp-subtle)]">Paused</span> : null}
          </p>
          <p className="truncate text-xs text-[var(--lp-subtle)]">
            {kinds[channel.kind].label} · <span className="lp-mono">{channel.target}</span> · {channel.events.map((e) => eventInfo[e]?.label ?? e).join(", ")}
          </p>
          <p className={cn("mt-1 flex items-start gap-1.5 text-xs", failing ? "text-[#ff8fb3]" : "text-[var(--lp-subtle)]")}>
            {failing ? <XCircle className="mt-px h-3.5 w-3.5 shrink-0" /> : channel.last_sent_at ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--lp-green)]" /> : null}
            <span className="min-w-0 break-words">
              {failing ? `Last delivery failed: ${channel.last_error}` : channel.last_sent_at ? `Last delivered ${relative(channel.last_sent_at)}` : "Nothing sent yet"}
            </span>
          </p>
          {test.data && !test.isPending ? (
            <p className={cn("mt-1 text-xs", test.data.ok ? "text-[var(--lp-green)]" : "text-[#ff8fb3]")}>{test.data.ok ? "Test delivered." : `Test failed: ${test.data.error}`}</p>
          ) : null}
        </div>
      </div>
      {canManage ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-11 sm:pl-0">
          <button type="button" className="console-btn console-btn-secondary" disabled={test.isPending} onClick={() => test.mutate()}>
            <Send className="h-3.5 w-3.5" /> {test.isPending ? "Sending…" : "Test"}
          </button>
          <button
            type="button"
            className="console-btn console-btn-secondary"
            disabled={toggle.isPending}
            aria-pressed={channel.enabled}
            onClick={() => toggle.mutate()}
          >
            {channel.enabled ? "Pause" : "Resume"}
          </button>
          <button type="button" className="console-btn console-btn-secondary h-8 w-8 px-0" aria-label={`Edit ${channel.name}`} onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="console-btn console-btn-secondary h-8 w-8 px-0 hover:text-[#ff8fb3]"
            aria-label={`Delete ${channel.name}`}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete ${channel.name}? Alerts stop going there right away.`)) remove.mutate();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function IntegrationsWorkspace() {
  const [dialog, setDialog] = useState<{ key: number; editing: NotificationChannel | null; kind: ChannelKind | null } | null>(null);
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => apiRequest<SessionResponse>("/api/auth/session") });
  const teamQuery = useQuery({ queryKey: ["workspace-team"], queryFn: () => apiRequest<WorkspaceTeamResponse>("/api/workspace/team") });
  const role = teamQuery.data?.workspace?.role;
  const isDemo = sessionQuery.data?.mode === "demo";
  const canManage = (role === "owner" || role === "admin") && !isDemo;

  const channelsQuery = useQuery({
    queryKey: ["workspace-channels"],
    queryFn: () => apiRequest<ChannelListResponse>("/api/workspace/channels"),
    enabled: sessionQuery.data?.authenticated === true,
  });
  const channels = channelsQuery.data?.channels ?? [];
  const openDialog = (editing: NotificationChannel | null, kind: ChannelKind | null = null) => setDialog({ key: Date.now(), editing, kind });

  return (
    <div className="grid grid-cols-1 gap-5">
      <SettingsPageTitle
        title="Integrations"
        description="Send alerts to the chat tools your team already watches, or to your own endpoint. Each monitor's email alerts keep working as before."
        action={
          canManage ? (
            <button type="button" className="console-btn console-btn-primary" onClick={() => openDialog(null)}>
              <Plus className="h-3.5 w-3.5" /> Add channel
            </button>
          ) : null
        }
      />

      {isDemo ? <Notice tone="info">The shared demo account can&apos;t add alert channels.</Notice> : null}
      {!teamQuery.isLoading && !canManage && !isDemo ? <Notice tone="info">Only workspace owners and admins can add or change channels.</Notice> : null}

      {dialog ? (
        <ChannelDialog key={dialog.key} open onClose={() => setDialog(null)} editing={dialog.editing} initialKind={dialog.kind} />
      ) : null}

      <SettingsCard id="channels" title="Alert channels" description="Every enabled channel gets the alerts it subscribes to, for every monitor in this workspace.">
        {channelsQuery.isLoading ? (
          <p className="text-sm text-[var(--lp-subtle)]">Loading…</p>
        ) : channelsQuery.isError ? (
          <Notice tone="error">{(channelsQuery.error as ApiError).message || "Couldn't load channels."}</Notice>
        ) : channels.length === 0 ? (
          <div>
            <p className="mb-3 text-sm text-[var(--lp-muted)]">No channels yet. Pick where alerts should go:</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(kinds) as ChannelKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  disabled={!canManage}
                  onClick={() => openDialog(null, k)}
                  className="flex items-start gap-3 rounded-lg border border-[var(--lp-border)] p-3 text-left transition-colors enabled:hover:bg-white/[0.03] disabled:opacity-60"
                >
                  <KindBadge kind={k} size="lg" />
                  <span className="min-w-0">
                    <span className="block text-base font-medium">{kinds[k].label}</span>
                    <span className="block text-xs leading-snug text-[var(--lp-subtle)]">{kinds[k].blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--lp-border)]">
            {channels.map((c) => (
              <ChannelRow key={c.id} channel={c} canManage={canManage} onEdit={() => openDialog(c)} />
            ))}
          </ul>
        )}
      </SettingsCard>
    </div>
  );
}
