"use client";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Check, Copy, ExternalLink, Pencil, Plus, Trash2 } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { Monitor, SessionResponse, StatusPage, StatusPageListResponse, StatusPageMonitor } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Field, PageHeader, Panel, Toggle } from "@/components/tools/probe-ui";
import { Modal } from "@/components/ui/modal";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const statusDot: Record<Monitor["status"], string> = { up: "#4ade80", down: "#ff5c5c", pending: "#85858e" };

function publicURL(slug: string) {
  if (typeof window === "undefined") return `/status/${slug}`;
  return `${window.location.origin}/status/${slug}`;
}

/** Create or edit a page: its title and address, then which monitors it shows and under what names. */
function PageDialog({ editing, monitors, isDemo, onClose }: { editing: StatusPage | null; monitors: Monitor[]; isDemo: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(editing?.title ?? "");
  const [slug, setSlug] = useState(editing?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(editing));
  const [description, setDescription] = useState(editing?.description ?? "");
  const [published, setPublished] = useState(editing?.published ?? !isDemo);
  const [chosen, setChosen] = useState<StatusPageMonitor[]>(editing?.monitors ?? []);

  const effectiveSlug = slugTouched ? slug : slugify(title);
  const slugOK = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(effectiveSlug) && !effectiveSlug.includes("--");
  const canSave = title.trim() !== "" && slugOK;

  const save = useMutation({
    mutationFn: () =>
      apiRequest<StatusPage>("/api/status-pages", {
        method: "POST",
        body: JSON.stringify({ id: editing?.id, title: title.trim(), slug: effectiveSlug, description, published, monitors: chosen }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["status-pages"] });
      onClose();
    },
  });

  const toggle = (m: Monitor) =>
    setChosen((cur) => (cur.some((c) => c.monitor_id === m.id) ? cur.filter((c) => c.monitor_id !== m.id) : [...cur, { monitor_id: m.id, label: m.name }]));
  const move = (index: number, delta: number) =>
    setChosen((cur) => {
      const next = [...cur];
      const target = index + delta;
      if (target < 0 || target >= next.length) return cur;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const byId = new Map(monitors.map((m) => [m.id, m]));

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? `Edit ${editing.title}` : "New status page"}
      description="A public page your customers can check. It shows the names you give each monitor, never its address."
      className="max-w-[640px]"
      footer={
        <>
          {save.isError ? <span className="mr-auto text-xs text-[#ff8fb3]">{(save.error as ApiError).message}</span> : null}
          <button type="button" className="console-btn console-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="status-page-form" className="console-btn console-btn-primary" disabled={!canSave || save.isPending}>
            {save.isPending ? "Saving" : editing ? "Save changes" : "Create page"}
          </button>
        </>
      }
    >
      <form
        id="status-page-form"
        className="grid gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save.mutate();
        }}
      >
        <Field label="Title">
          <input className="h-9 w-full px-3" placeholder="Acme status" maxLength={80} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Address" error={effectiveSlug && !slugOK ? "3 to 40 lowercase letters, numbers, or single hyphens" : undefined}>
          <div className="flex h-9 items-center overflow-hidden rounded-md border border-[var(--lp-border-strong)] bg-black/20 focus-within:border-[rgba(255,61,127,0.5)]">
            <span className="lp-mono shrink-0 border-r border-[var(--lp-border)] px-3 text-xs text-[var(--lp-subtle)]">/status/</span>
            <input
              className="lp-mono h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-sm outline-none"
              placeholder="acme"
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
            />
          </div>
        </Field>
        <Field label="Description" hint="Optional. Shown under the title, such as what the page covers or where to get help.">
          <textarea className="min-h-[64px] w-full px-3 py-2" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div>
          <p className="mb-2 text-sm text-[var(--lp-muted)]">Monitors on this page</p>
          {monitors.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--lp-border)] px-4 py-5 text-center text-sm text-[var(--lp-subtle)]">
              No monitors yet. <Link href="/monitors" className="text-[var(--lp-text)] underline underline-offset-4">Add one</Link> first.
            </p>
          ) : (
            <div className="grid gap-2">
              {chosen.length ? (
                <ol className="grid gap-1.5">
                  {chosen.map((c, i) => {
                    const m = byId.get(c.monitor_id);
                    return (
                      <li key={c.monitor_id} className="flex items-center gap-2 rounded-lg border border-[rgba(255,61,127,0.35)] bg-[rgba(255,61,127,0.04)] px-2.5 py-2">
                        <span className="flex flex-col" aria-hidden="true">
                          <button type="button" className="text-[var(--lp-subtle)] hover:text-white disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                            ▲
                          </button>
                          <button type="button" className="text-[var(--lp-subtle)] hover:text-white disabled:opacity-30" disabled={i === chosen.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                            ▼
                          </button>
                        </span>
                        <input
                          aria-label="Display name"
                          className="h-8 min-w-0 flex-1 px-2 text-sm"
                          maxLength={60}
                          value={c.label}
                          onChange={(e) => setChosen((cur) => cur.map((x) => (x.monitor_id === c.monitor_id ? { ...x, label: e.target.value } : x)))}
                        />
                        <span className="hidden max-w-[160px] truncate text-2xs text-[var(--lp-subtle)] sm:block" title={m?.name}>
                          {m?.name ?? "Removed monitor"}
                        </span>
                        <button type="button" className="console-btn console-btn-secondary h-8 w-8 px-0" aria-label="Remove from page" onClick={() => m && toggle(m)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ol>
              ) : null}
              <div className="flex flex-wrap gap-1.5">
                {monitors
                  .filter((m) => !chosen.some((c) => c.monitor_id === m.id))
                  .map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggle(m)}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--lp-border)] px-2 py-1 text-xs text-[var(--lp-muted)] hover:border-[var(--lp-border-strong)] hover:text-white"
                    >
                      <Plus className="h-3 w-3 shrink-0" />
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: statusDot[m.status] }} />
                      <span className="truncate">{m.name}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>

        <Toggle
          label="Published"
          description={isDemo ? "The shared demo account can't publish pages." : "Anyone with the link can see it. Unpublished pages show a not-found page."}
          checked={published}
          disabled={isDemo}
          onChange={(e) => setPublished(e.target.checked)}
        />
      </form>
    </Modal>
  );
}

function PageCard({ page, monitors, onEdit }: { page: StatusPage; monitors: Map<number, Monitor>; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const remove = useMutation({
    mutationFn: () => apiRequest(`/api/status-pages?id=${page.id}`, { method: "DELETE" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["status-pages"] }),
  });
  const shown = page.monitors.map((m) => monitors.get(m.monitor_id)).filter((m): m is Monitor => Boolean(m));
  const down = shown.filter((m) => m.enabled && m.status === "down").length;

  return (
    <li className="flex flex-col gap-4 rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f] p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-md font-medium">
          <span className="truncate">{page.title}</span>
          {page.published ? (
            <span className="rounded border border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.08)] px-1.5 text-2xs font-normal text-[#86efac]">Public</span>
          ) : (
            <span className="rounded border border-[var(--lp-border-strong)] px-1.5 text-2xs font-normal text-[var(--lp-subtle)]">Draft</span>
          )}
        </p>
        <p className="lp-mono mt-0.5 truncate text-xs text-[var(--lp-subtle)]">/status/{page.slug}</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--lp-muted)]">
          <span>
            {page.monitors.length} {page.monitors.length === 1 ? "monitor" : "monitors"}
          </span>
          {shown.length ? (
            down ? (
              <span className="text-[#ff8fb3]">{down} down right now</span>
            ) : (
              <span className="text-[#86efac]">All up</span>
            )
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-1.5">
        {page.published ? (
          <>
            <a href={`/status/${page.slug}`} target="_blank" rel="noreferrer" className="console-btn console-btn-secondary">
              <ExternalLink className="h-3.5 w-3.5" /> View
            </a>
            <button
              type="button"
              className="console-btn console-btn-secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(publicURL(page.slug)).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5 text-[var(--lp-green)]" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy link"}
            </button>
          </>
        ) : null}
        <button type="button" className="console-btn console-btn-secondary h-8 w-8 px-0" aria-label={`Edit ${page.title}`} onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <ConfirmDialog
          title={`Delete ${page.title}?`}
          message="Its public link stops working right away. This can't be undone."
          confirmLabel="Delete page"
          busy={remove.isPending}
          onConfirm={() => remove.mutate()}
          trigger={(open) => (
            <button
              type="button"
              className="console-btn console-btn-secondary h-8 w-8 px-0 hover:text-[#ff8fb3]"
              aria-label={`Delete ${page.title}`}
              disabled={remove.isPending}
              onClick={open}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        />
      </div>
    </li>
  );
}

export function StatusPagesWorkspace() {
  const [dialog, setDialog] = useState<{ key: number; editing: StatusPage | null } | null>(null);
  const sessionQuery = useQuery({ queryKey: ["session"], queryFn: () => apiRequest<SessionResponse>("/api/auth/session") });
  const enabled = sessionQuery.data?.authenticated === true;
  const isDemo = sessionQuery.data?.mode === "demo";
  const pagesQuery = useQuery({ queryKey: ["status-pages"], queryFn: () => apiRequest<StatusPageListResponse>("/api/status-pages"), enabled });
  const monitorsQuery = useQuery({ queryKey: ["monitors"], queryFn: () => apiRequest<Monitor[]>("/api/monitors"), enabled });

  const pages = pagesQuery.data?.pages ?? [];
  const limit = pagesQuery.data?.limit ?? 0;
  const monitors = monitorsQuery.data ?? [];
  const byId = new Map(monitors.map((m) => [m.id, m]));
  const atLimit = limit > 0 && pages.length >= limit;

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <PageHeader
          title="Status pages"
          description="Public pages that show your customers whether your services are up, with 30 days of history. They show the names you choose, never hostnames or addresses."
        />
        <button
          type="button"
          className="console-btn console-btn-primary shrink-0"
          disabled={atLimit}
          title={atLimit ? `Your plan includes ${limit} status ${limit === 1 ? "page" : "pages"}` : undefined}
          onClick={() => setDialog({ key: Date.now(), editing: null })}
        >
          <Plus className="h-3.5 w-3.5" /> New status page
        </button>
      </div>

      {atLimit ? (
        <p className="text-xs text-[var(--lp-subtle)]">
          Your plan includes {limit} status {limit === 1 ? "page" : "pages"}.{" "}
          <Link href="/workspace/billing" className="text-[var(--lp-text)] underline underline-offset-4">
            Upgrade for more
          </Link>
          .
        </p>
      ) : null}

      {dialog ? <PageDialog key={dialog.key} editing={dialog.editing} monitors={monitors} isDemo={isDemo} onClose={() => setDialog(null)} /> : null}

      {pagesQuery.isLoading ? (
        <p className="text-sm text-[var(--lp-subtle)]">Loading…</p>
      ) : pagesQuery.isError ? (
        <p className="text-sm text-[#ff8fb3]">{(pagesQuery.error as ApiError).message}</p>
      ) : pages.length === 0 ? (
        <Panel>
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <BadgeCheck className="h-6 w-6 text-[var(--lp-subtle)]" aria-hidden="true" />
            <p className="mt-3 text-md font-medium">No status page yet</p>
            <p className="mt-1 max-w-md text-sm text-[var(--lp-subtle)]">
              Pick the monitors your customers care about, give them friendly names, and share one link during an incident instead of answering the same question all day.
            </p>
            <button type="button" className="console-btn console-btn-primary mt-5" onClick={() => setDialog({ key: Date.now(), editing: null })}>
              <Plus className="h-3.5 w-3.5" /> Create a status page
            </button>
          </div>
        </Panel>
      ) : (
        <ul className={cn("grid gap-3")}>
          {pages.map((p) => (
            <PageCard key={p.id} page={p} monitors={byId} onEdit={() => setDialog({ key: Date.now(), editing: p })} />
          ))}
        </ul>
      )}
    </div>
  );
}
