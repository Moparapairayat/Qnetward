"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FileText, ScrollText } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import type { DeepScanListResponse, DeepScanRequest, DeepScanPreview, DeepReport, SecurityScan, SurfaceReport, VerifiedDomainListResponse } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { Field, PageHeader, Panel, RunStatus } from "@/components/tools/probe-ui";
import { GradeBadge, severityMeta } from "@/features/passive-checks/passive-checks-workspace";

const statusMeta: Record<DeepScanRequest["status"], { label: string; pill: string }> = {
  pending: { label: "Awaiting review", pill: "border-[rgba(167,139,250,0.3)] bg-[rgba(167,139,250,0.08)] text-[#c4b5fd]" },
  approved: { label: "Approved", pill: "border-[rgba(96,165,250,0.3)] bg-[rgba(96,165,250,0.08)] text-[#93c5fd]" },
  running: { label: "Running", pill: "border-[rgba(96,165,250,0.3)] bg-[rgba(96,165,250,0.08)] text-[#93c5fd]" },
  completed: { label: "Completed", pill: "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]" },
  rejected: { label: "Not approved", pill: "border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] text-[#ff8fb3]" },
  failed: { label: "Failed", pill: "border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] text-[#ff8fb3]" },
  cancelled: { label: "Cancelled", pill: "border-[var(--lp-border)] bg-white/[0.03] text-[var(--lp-muted)]" },
  expired: { label: "Expired", pill: "border-[var(--lp-border)] bg-white/[0.03] text-[var(--lp-muted)]" },
};

const windowLabel: Record<number, string> = { 24: "24 hours", 72: "3 days", 168: "7 days" };

/** The signed authorization, as it was signed. */
export function ConsentBox({ text, className }: { text: string; className?: string }) {
  return (
    <pre className={cn("max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--lp-border)] bg-black/25 p-3.5 font-sans text-xs leading-relaxed text-[var(--lp-muted)]", className)}>
      {text}
    </pre>
  );
}

function RequestForm({ perMonth, onDone }: { perMonth: number; onDone: () => void }) {
  const domains = useQuery({ queryKey: ["asset-domains"], queryFn: () => apiRequest<VerifiedDomainListResponse>("/api/assets/domains") });
  const verified = (domains.data?.domains ?? []).filter((d) => d.status === "verified");
  const [domain, setDomain] = useState("");
  const target = domain || verified[0]?.domain || "";
  const [hostsText, setHostsText] = useState("");
  const [windowHours, setWindowHours] = useState(24);
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<DeepScanPreview | null>(null);
  const [agree, setAgree] = useState(false);
  const hosts = (hostsText.trim() ? hostsText : target).split(/[\s,]+/).map((h) => h.trim()).filter(Boolean);

  const latest = useQuery({
    queryKey: ["surface-scans"],
    queryFn: () => apiRequest<{ scans: SecurityScan[] }>("/api/security/surface?limit=30"),
  });
  const lastScan = latest.data?.scans.find((s) => s.domain === target && s.status === "done");
  const fillFromScan = useMutation({
    mutationFn: () => apiRequest<SecurityScan>(`/api/security/surface?id=${lastScan!.id}`),
    onSuccess: (s) => {
      const rep = s.report as unknown as SurfaceReport | undefined;
      const names = (rep?.hosts ?? []).filter((h) => !h.private && h.open_ports.some((p) => p === 80 || p === 443 || p === 8080 || p === 8443)).map((h) => h.name);
      setHostsText(names.slice(0, 20).join("\n"));
      setPreview(null);
    },
  });

  const body = () => ({ domain: target, hosts, window_hours: windowHours, name, checks: ["exposed_files"] });
  const review = useMutation({
    mutationFn: () => apiRequest<DeepScanPreview>("/api/security/deep?preview=1", { method: "POST", body: JSON.stringify(body()) }),
    onSuccess: (p) => {
      setPreview(p);
      setAgree(false);
    },
  });
  const submit = useMutation({
    mutationFn: () =>
      apiRequest<DeepScanRequest>("/api/security/deep", {
        method: "POST",
        body: JSON.stringify({ ...preview!.input, consent_hash: preview!.hash, accept: agree }),
      }),
    onSuccess: () => {
      setPreview(null);
      setName("");
      onDone();
    },
  });

  if (domains.isSuccess && verified.length === 0) {
    return (
      <p className="text-sm text-[var(--lp-muted)]">
        Deep scans run only on domains you&apos;ve verified.{" "}
        <Link href="/assets" className="text-[var(--lp-text)] underline">
          Verify one in Assets
        </Link>
        .
      </p>
    );
  }

  if (preview) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-[var(--lp-text)]">Read the authorization. Signing it records your name, the time, your address, and this exact text.</p>
        <ConsentBox text={preview.text} />
        <label className="flex items-start gap-2.5 text-sm text-[var(--lp-muted)]">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--lp-accent)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          I have read this, the details are correct, and I am authorized to sign it.
        </label>
        {submit.isError ? <p className="text-xs text-[#ff8fb3]">{(submit.error as ApiError).message}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="console-btn console-btn-primary h-9 px-4" disabled={!agree || submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? "Submitting…" : "Sign and submit for review"}
          </button>
          <button type="button" className="console-btn console-btn-secondary h-9 px-4" onClick={() => setPreview(null)}>
            Change details
          </button>
        </div>
        <p className="text-xs text-[var(--lp-subtle)]">A Qnetward admin reviews every request. Nothing runs until it&apos;s approved, and only inside the window and hosts above.</p>
      </div>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        review.mutate();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Verified domain">
          <select
            className="h-9 w-full px-3"
            value={target}
            onChange={(e) => {
              setDomain(e.target.value);
              setHostsText("");
            }}
          >
            {verified.map((d) => (
              <option key={d.id} value={d.domain}>
                {d.domain}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Window">
          <select className="h-9 w-full px-3" value={windowHours} onChange={(e) => setWindowHours(Number(e.target.value))}>
            {[24, 72, 168].map((h) => (
              <option key={h} value={h}>
                Starting on approval, for {windowLabel[h]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Hosts in scope" hint="One per line, up to 20, all under the verified domain.">
        <textarea className="min-h-24 w-full px-3 py-2 font-mono text-xs" placeholder={target} value={hostsText} onChange={(e) => setHostsText(e.target.value)} />
      </Field>
      {lastScan ? (
        <button type="button" className="-mt-2 w-fit text-xs text-[var(--lp-muted)] underline hover:text-[var(--lp-text)]" disabled={fillFromScan.isPending} onClick={() => fillFromScan.mutate()}>
          Use the web hosts from the last attack surface scan
        </button>
      ) : null}
      <div className="rounded-lg border border-[var(--lp-border)] bg-white/[0.02] p-3">
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--lp-accent)]" checked disabled readOnly />
          <span>
            <span className="text-[var(--lp-text)]">Exposed files</span>
            <span className="block text-xs leading-relaxed text-[var(--lp-subtle)]">
              Looks for about 20 files that should never be public, such as .git, .env, backups, and database dumps, at a gentle pace. Contents are never stored.
            </span>
          </span>
        </label>
      </div>
      <Field label="Your full name, to sign" hint="The authorization is signed in your name.">
        <input className="h-9 w-full px-3" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
      </Field>
      {review.isError ? <p className="text-xs text-[#ff8fb3]">{(review.error as ApiError).message}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="console-btn console-btn-primary h-9 px-4" disabled={!target || name.trim().length < 3 || review.isPending}>
          {review.isPending ? "Preparing…" : "Review authorization"}
        </button>
        <span className="text-xs text-[var(--lp-subtle)]">Your plan allows {perMonth} requests in 30 days.</span>
      </div>
    </form>
  );
}

function DeepReportView({ scanId }: { scanId: number }) {
  const scan = useQuery({ queryKey: ["deep-scan", scanId], queryFn: () => apiRequest<SecurityScan>(`/api/security/passive?id=${scanId}`), staleTime: Infinity });
  const rep = scan.data?.report as unknown as DeepReport | undefined;
  if (!rep) return <p className="px-1 py-3 text-xs text-[var(--lp-subtle)]">Loading results…</p>;
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <GradeBadge grade={rep.grade} size="sm" />
        <p className="text-xs text-[var(--lp-muted)]">
          {rep.findings.length} finding{rep.findings.length === 1 ? "" : "s"} from {rep.requests} requests across {rep.hosts.length} host{rep.hosts.length === 1 ? "" : "s"},{" "}
          {formatDateTime(rep.checked_at)}.
        </p>
      </div>
      {rep.findings.length ? (
        <ul className="divide-y divide-[var(--lp-border)] rounded-lg border border-[var(--lp-border)]">
          {rep.findings.map((f, i) => (
            <li key={`${f.url}-${i}`} className="grid gap-1 px-3 py-2.5">
              <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--lp-text)]">
                <span className={cn("rounded-md border px-1.5 py-px text-2xs", severityMeta[f.severity].pill)}>{severityMeta[f.severity].label}</span>
                {f.title}
              </p>
              <p className="lp-mono break-all text-2xs text-[var(--lp-subtle)]">{f.url}</p>
              <p className="text-xs text-[var(--lp-muted)]">{f.fix}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#86efac]">No exposed files found.</p>
      )}
      {rep.skipped?.length ? <p className="text-xs text-[#fbbf24]">Skipped: {rep.skipped.join("; ")}</p> : null}
    </div>
  );
}

function RequestRow({ req, onCancel, cancelling }: { req: DeepScanRequest; onCancel: () => void; cancelling: boolean }) {
  const [open, setOpen] = useState(req.status === "completed");
  const meta = statusMeta[req.status];
  return (
    <li className="border-t border-[var(--lp-border)] first:border-t-0">
      <button type="button" className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.015]" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-base font-medium">{req.domain}</span>
            <span className={cn("rounded-md border px-1.5 py-px text-2xs", meta.pill)}>{meta.label}</span>
          </span>
          <span className="mt-0.5 block text-xs text-[var(--lp-subtle)]">
            {req.hosts.length} host{req.hosts.length === 1 ? "" : "s"} · {formatDateTime(req.window_start)} to {formatDateTime(req.window_end)} · signed by {req.consent_name}
          </span>
        </span>
        <ChevronDown className={cn("mt-1 h-3.5 w-3.5 shrink-0 text-[var(--lp-subtle)] transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="grid gap-3 px-4 pb-4">
          {req.review_note ? (
            <p className="rounded-lg border border-[var(--lp-border)] bg-white/[0.02] px-3 py-2 text-xs text-[var(--lp-muted)]">Reviewer&apos;s note: {req.review_note}</p>
          ) : null}
          {req.status === "completed" && req.scan_id ? <DeepReportView scanId={req.scan_id} /> : null}
          <p className="lp-mono break-all text-2xs text-[var(--lp-subtle)]">Hosts: {req.hosts.join(", ")}</p>
          <details className="text-xs text-[var(--lp-muted)]">
            <summary className="cursor-pointer">Signed authorization (SHA-256 {req.consent_hash.slice(0, 12)}…)</summary>
            <ConsentBox text={req.consent_text} className="mt-2" />
          </details>
          {req.status === "pending" || req.status === "approved" ? (
            <button type="button" className="console-btn console-btn-secondary h-8 w-fit px-3" disabled={cancelling} onClick={onCancel}>
              {cancelling ? "Cancelling…" : "Withdraw request"}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function DeepScansWorkspace() {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["deep-scans"],
    queryFn: () => apiRequest<DeepScanListResponse>("/api/security/deep"),
    refetchInterval: (q) => (q.state.data?.requests.some((r) => r.status === "running" || r.status === "approved") ? 5000 : 30_000),
  });
  const requests = useMemo(() => list.data?.requests ?? [], [list.data]);
  const perMonth = list.data?.per_month ?? 0;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["deep-scans"] });
  const cancel = useMutation({ mutationFn: (id: number) => apiRequest(`/api/security/deep?id=${id}`, { method: "DELETE" }), onSuccess: refresh });
  const pending = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="Deep scans"
        description="Checks that go further than a visitor would, such as looking for exposed .git folders, .env files, and database dumps. Each one needs your signed authorization for an exact scope and window, and a Qnetward admin's approval before it runs."
        status={pending ? <RunStatus tone="idle" label={`${pending} awaiting review`} /> : null}
      />

      {list.isSuccess && perMonth <= 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--lp-border)] px-6 py-12 text-center">
          <ScrollText className="h-6 w-6 text-[var(--lp-subtle)]" />
          <p className="mt-3 text-base text-[var(--lp-muted)]">Deep scans are on the Pro and Enterprise plans</p>
          <p className="mt-1 max-w-md text-sm text-[var(--lp-subtle)]">Passive checks, attack surface scans, and vulnerabilities stay available on every plan.</p>
          <Link href="/workspace/billing" className="console-btn console-btn-primary mt-4 h-9 px-4">
            See plans
          </Link>
        </div>
      ) : (
        <Panel title="New request">
          <RequestForm perMonth={perMonth} onDone={refresh} />
        </Panel>
      )}

      <Panel title="Requests" bodyClassName="p-0">
        {requests.length ? (
          <ul className="border-t border-[var(--lp-border)]">
            {requests.map((r) => (
              <RequestRow key={r.id} req={r} cancelling={cancel.isPending && cancel.variables === r.id} onCancel={() => cancel.mutate(r.id)} />
            ))}
          </ul>
        ) : (
          <div className="flex items-center gap-2 border-t border-[var(--lp-border)] px-4 py-4 text-sm text-[var(--lp-subtle)]">
            <FileText className="h-4 w-4" /> {list.isLoading ? "Loading…" : "No requests yet."}
          </div>
        )}
      </Panel>
    </div>
  );
}
