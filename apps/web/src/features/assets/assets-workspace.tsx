"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Boxes,
  Check,
  Copy,
  Globe,
  RefreshCw,
  Trash2,
} from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { VerifiedDomain, VerifiedDomainListResponse } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { useLiveInterval } from "@/lib/live";
import {
  Field,
  PageHeader,
  Panel,
  RunStatus,
} from "@/components/tools/probe-ui";

const statusMeta: Record<
  VerifiedDomain["status"],
  { label: string; pill: string }
> = {
  verified: {
    label: "Verified",
    pill: "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]",
  },
  pending: {
    label: "Waiting for proof",
    pill: "border-[rgba(167,139,250,0.3)] bg-[rgba(167,139,250,0.08)] text-[#c4b5fd]",
  },
  lapsed: {
    label: "Lapsed",
    pill: "border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.1)] text-[#ff8fb3]",
  },
};

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-w-0">
      <p className="mb-1 text-2xs uppercase tracking-[0.06em] text-[var(--lp-subtle)]">
        {label}
      </p>
      <div className="flex items-center gap-2 rounded-lg border border-[var(--lp-border)] bg-black/20 px-3 py-2">
        <code className="lp-mono min-w-0 flex-1 break-all text-xs text-[var(--lp-text)]">
          {value}
        </code>
        <button
          type="button"
          className="shrink-0 rounded p-1 text-[var(--lp-subtle)] hover:text-[var(--lp-text)]"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-[#86efac]" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

/** How to prove a domain: a TXT record, or a file on the site. */
function ProofSteps({ domain }: { domain: VerifiedDomain }) {
  const [method, setMethod] = useState<"dns" | "http">("dns");
  return (
    <div className="grid gap-3 rounded-lg border border-[var(--lp-border)] bg-white/[0.015] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--lp-text)]">
          Prove you control {domain.domain}, one of two ways:
        </p>
        <div
          className="flex rounded-lg border border-[var(--lp-border)] p-0.5"
          role="tablist"
          aria-label="Proof method"
        >
          {(["dns", "http"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={method === m}
              onClick={() => setMethod(m)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs",
                method === m
                  ? "bg-white/[0.08] text-[var(--lp-text)]"
                  : "text-[var(--lp-muted)]",
              )}
            >
              {m === "dns" ? "DNS record" : "File on the site"}
            </button>
          ))}
        </div>
      </div>
      {method === "dns" ? (
        <>
          <p className="text-xs leading-relaxed text-[var(--lp-muted)]">
            At your DNS provider, add a TXT record. It can take a few minutes to
            appear.
          </p>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <CopyValue label="Name" value={domain.record_name} />
            <CopyValue label="Value" value={domain.token} />
          </div>
        </>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-[var(--lp-muted)]">
            Serve a plain-text file at this address that contains only the
            token.
          </p>
          <div className="grid gap-2">
            <CopyValue label="Address" value={domain.file_url} />
            <CopyValue label="Contents" value={domain.token} />
          </div>
        </>
      )}
      <p className="text-xs text-[var(--lp-subtle)]">
        We also look for it every hour for a week. Keep it in place: we re-check
        daily, and a domain without it for a week lapses.
      </p>
    </div>
  );
}

function DomainRow({
  domain,
  verifying,
  removing,
  onVerify,
  onRemove,
}: {
  domain: VerifiedDomain;
  verifying: boolean;
  removing: boolean;
  onVerify: () => void;
  onRemove: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const meta = statusMeta[domain.status];
  const verified = domain.status === "verified";
  return (
    <li className="grid gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {verified ? (
          <BadgeCheck className="h-5 w-5 shrink-0 text-[#86efac]" />
        ) : (
          <Globe className="h-5 w-5 shrink-0 text-[var(--lp-subtle)]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-medium">
              {domain.domain}
            </h3>
            <span
              className={cn(
                "rounded-md border px-1.5 py-px text-2xs",
                meta.pill,
              )}
            >
              {meta.label}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--lp-subtle)]">
            {verified ? (
              <>
                Verified by {domain.method === "dns" ? "DNS record" : "file"}
                {domain.verified_at
                  ? ` on ${formatDateTime(domain.verified_at)}`
                  : ""}
                . Covers every subdomain.
                {domain.last_error ? (
                  <span className="text-[#fbbf24]">
                    {" "}
                    The proof was missing at the last check; it lapses after a
                    week without it.
                  </span>
                ) : null}
              </>
            ) : domain.status === "lapsed" ? (
              "The proof has been missing for a week. Publish it again and verify."
            ) : domain.last_checked_at ? (
              `Last looked ${formatDateTime(domain.last_checked_at)}.`
            ) : (
              `Added ${formatDateTime(domain.created_at)}.`
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!verified ? (
            <button
              type="button"
              className="console-btn console-btn-primary h-8 px-3"
              disabled={verifying}
              onClick={onVerify}
            >
              {verifying ? "Checking…" : "Verify now"}
            </button>
          ) : (
            <button
              type="button"
              className="console-btn h-8 w-8 px-0 text-[var(--lp-muted)] hover:bg-white/[0.05]"
              aria-label={`Check ${domain.domain} again`}
              title="Check the proof again"
              disabled={verifying}
              onClick={onVerify}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", verifying && "animate-spin")}
              />
            </button>
          )}
          {confirm ? (
            <>
              <button
                type="button"
                className="console-btn h-8 bg-[rgba(255,61,127,0.15)] px-2.5 text-[#ff8fb3]"
                disabled={removing}
                onClick={onRemove}
              >
                {removing ? "Removing" : "Remove"}
              </button>
              <button
                type="button"
                className="console-btn console-btn-secondary h-8 px-2.5"
                onClick={() => setConfirm(false)}
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              className="console-btn h-8 w-8 px-0 text-[var(--lp-muted)] hover:bg-[rgba(255,61,127,0.1)] hover:text-[#ff8fb3]"
              aria-label={`Remove ${domain.domain}`}
              onClick={() => setConfirm(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {!verified && domain.last_error ? (
        <p className="rounded-lg border border-[rgba(251,191,36,0.25)] bg-[rgba(251,191,36,0.06)] px-3 py-2 text-xs leading-relaxed text-[#fcd34d]">
          Not found yet: {domain.last_error}
        </p>
      ) : null}
      {!verified ? <ProofSteps domain={domain} /> : null}
    </li>
  );
}

export function AssetsWorkspace() {
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState("");
  const [notice, setNotice] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const liveFallback = useLiveInterval(60_000);
  const list = useQuery({
    queryKey: ["asset-domains"],
    queryFn: () =>
      apiRequest<VerifiedDomainListResponse>("/api/assets/domains"),
    refetchInterval: liveFallback,
  });
  const domains = list.data?.domains ?? [];
  const limit = list.data?.limit ?? 0;
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["asset-domains"] });

  const add = useMutation({
    mutationFn: (d: string) =>
      apiRequest<VerifiedDomain>("/api/assets/domains", {
        method: "POST",
        body: JSON.stringify({ domain: d }),
      }),
    onSuccess: async (d) => {
      setDomain("");
      setNotice({
        tone: "ok",
        text: `Added ${d.domain}. Publish the proof below, then verify.`,
      });
      await refresh();
    },
    onError: (e: ApiError) => setNotice({ tone: "error", text: e.message }),
  });
  const verify = useMutation({
    mutationFn: (id: number) => {
      setBusyId(id);
      return apiRequest<VerifiedDomain>("/api/assets/domains/verify", {
        method: "POST",
        body: JSON.stringify({ id }),
      });
    },
    onSuccess: async (d) => {
      setNotice(
        d.status === "verified"
          ? {
              tone: "ok",
              text: `${d.domain} is verified. Deeper checks can now run on it and its subdomains.`,
            }
          : {
              tone: "error",
              text: `The proof for ${d.domain} wasn't found yet.`,
            },
      );
      await refresh();
    },
    onError: (e: ApiError) => setNotice({ tone: "error", text: e.message }),
    onSettled: () => setBusyId(null),
  });
  const remove = useMutation({
    mutationFn: (id: number) => {
      setBusyId(id);
      return apiRequest(`/api/assets/domains?id=${id}`, { method: "DELETE" });
    },
    onSuccess: refresh,
    onError: (e: ApiError) => setNotice({ tone: "error", text: e.message }),
    onSettled: () => setBusyId(null),
  });

  const verifiedCount = domains.filter((d) => d.status === "verified").length;

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="Assets"
        description="Domains your workspace has proved it controls. Checks deeper than a passive one, like finding subdomains and open ports, only run on these and their subdomains, so nobody can point them at a site that isn't theirs."
        status={
          domains.length ? (
            <RunStatus
              tone={verifiedCount ? "live" : "idle"}
              label={`${verifiedCount} of ${domains.length} verified`}
            />
          ) : null
        }
      />

      <form
        className="rounded-xl border border-[var(--lp-border)] bg-[#0a0a0a] p-4"
        onSubmit={(e) => {
          e.preventDefault();
          setNotice(null);
          if (domain.trim()) add.mutate(domain.trim());
        }}
      >
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <Field label="Domain">
            <input
              id="asset-domain"
              className="h-10 w-full px-3"
              placeholder="example.com"
              autoComplete="off"
              spellCheck={false}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            />
          </Field>
          <button
            type="submit"
            className="console-btn console-btn-primary h-10 px-5"
            disabled={
              add.isPending ||
              !domain.trim() ||
              (limit > 0 && domains.length >= limit)
            }
          >
            {add.isPending
              ? "Adding…"
              : limit > 0 && domains.length >= limit
                ? `Limit of ${limit} reached`
                : "Add domain"}
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--lp-subtle)]">
          Add the top domain you own, like example.com; proving it covers every
          name under it.
        </p>
      </form>

      {notice ? (
        <p
          role="status"
          className={cn(
            "rounded-lg border px-3 py-2.5 text-sm",
            notice.tone === "ok"
              ? "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]"
              : "border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] text-[#ff8fb3]",
          )}
        >
          {notice.text}
        </p>
      ) : null}

      <Panel
        title="Domains"
        bodyClassName="p-0"
        aside={
          limit ? (
            <span className="text-xs text-[var(--lp-subtle)]">
              {domains.length} of {limit}
            </span>
          ) : null
        }
      >
        {list.isLoading ? (
          <p className="px-4 pb-4 text-sm text-[var(--lp-subtle)]">
            Loading…
          </p>
        ) : domains.length ? (
          <ul className="divide-y divide-[var(--lp-border)] border-t border-[var(--lp-border)]">
            {domains.map((d) => (
              <DomainRow
                key={d.id}
                domain={d}
                verifying={verify.isPending && busyId === d.id}
                removing={remove.isPending && busyId === d.id}
                onVerify={() => {
                  setNotice(null);
                  verify.mutate(d.id);
                }}
                onRemove={() => remove.mutate(d.id)}
              />
            ))}
          </ul>
        ) : (
          <div className="mx-4 mb-4 flex flex-col items-center rounded-lg border border-dashed border-[var(--lp-border)] px-6 py-12 text-center">
            <Boxes className="h-5 w-5 text-[var(--lp-subtle)]" />
            <p className="mt-3 text-sm text-[var(--lp-muted)]">
              No domains yet
            </p>
            <p className="mt-1 max-w-md text-xs text-[var(--lp-subtle)]">
              Add a domain above, then prove it&apos;s yours with a DNS record
              or a small file on the site.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
