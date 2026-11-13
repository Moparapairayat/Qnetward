"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/api";
import type { DeepScanRequest } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { PageHeader, Panel, RunStatus } from "@/components/tools/probe-ui";
import { Pill, Segmented } from "@/features/admin/admin-ui";
import { ConsentBox } from "@/features/deep-scans/deep-scans-workspace";

type Filter = "pending" | "";

function ReviewCard({ req }: { req: DeepScanRequest }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const review = useMutation({
    mutationFn: (approve: boolean) => apiRequest("/api/admin/deep-scans", { method: "POST", body: JSON.stringify({ id: req.id, approve, note: note.trim() }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-deep-scans"] }),
  });
  const pending = req.status === "pending";
  return (
    <li className="grid gap-3 border-t border-[var(--lp-border)] px-4 py-4 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-medium">{req.domain}</span>
        <Pill tone={pending ? "accent" : req.status === "rejected" ? "bad" : req.status === "completed" ? "good" : "muted"}>{req.status}</Pill>
        <span className="text-xs text-[var(--lp-subtle)]">
          {req.workspace_name || `Workspace ${req.workspace_id}`} · signed by {req.consent_name} from {req.consent_ip || "unknown"} · {formatDateTime(req.created_at)}
        </span>
      </div>
      <p className="lp-mono break-all text-xs text-[var(--lp-muted)]">
        {req.hosts.join(", ")} · {req.checks.join(", ")} · {formatDateTime(req.window_start)} → {formatDateTime(req.window_end)}
      </p>
      <ConsentBox text={req.consent_text} className="max-h-60" />
      <p className="lp-mono text-2xs text-[var(--lp-subtle)]">SHA-256 {req.consent_hash}</p>
      {pending ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input className="h-9 w-full px-3 text-sm" placeholder="Note for the requester (required to reject)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="console-btn console-btn-primary h-9 px-4" disabled={review.isPending} onClick={() => review.mutate(true)}>
            Approve
          </button>
          <button
            type="button"
            className="console-btn h-9 bg-[rgba(255,61,127,0.15)] px-4 text-[#ff8fb3] hover:bg-[rgba(255,61,127,0.25)]"
            disabled={review.isPending || !note.trim()}
            onClick={() => review.mutate(false)}
          >
            Reject
          </button>
          {review.isError ? <p className="text-xs text-[#ff8fb3] sm:col-span-3">{(review.error as ApiError).message}</p> : null}
        </div>
      ) : req.reviewer_email ? (
        <p className="text-xs text-[var(--lp-subtle)]">
          Reviewed by {req.reviewer_email} {req.reviewed_at ? formatDateTime(req.reviewed_at) : ""}
          {req.review_note ? `: ${req.review_note}` : ""}
        </p>
      ) : null}
    </li>
  );
}

export function AdminDeepScansWorkspace() {
  const [filter, setFilter] = useState<Filter>("pending");
  const list = useQuery({
    queryKey: ["admin-deep-scans", filter],
    queryFn: () => apiRequest<{ requests: DeepScanRequest[] }>(`/api/admin/deep-scans?status=${filter}`),
    refetchInterval: 30_000,
  });
  const requests = list.data?.requests ?? [];
  const pending = filter === "pending" ? requests.length : requests.filter((r) => r.status === "pending").length;

  return (
    <div className="grid grid-cols-1 gap-5 [&>*]:min-w-0">
      <PageHeader
        title="Deep scan reviews"
        description="Every Tier 2 request waits here for a decision. Check that the hosts match the verified domain, the window is reasonable, and the signer is plausibly authorized. Approved scans start when their window opens."
        status={pending ? <RunStatus tone="idle" label={`${pending} to review`} /> : null}
      />
      <Panel
        title="Requests"
        bodyClassName="p-0"
        aside={
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { id: "pending", label: "To review" },
              { id: "", label: "All" },
            ]}
          />
        }
      >
        {list.isError ? (
          <p className="px-4 pb-4 text-sm text-[#ff8fb3]">{(list.error as ApiError).message}</p>
        ) : requests.length ? (
          <ul className={cn("border-t border-[var(--lp-border)]")}>
            {requests.map((r) => (
              <ReviewCard key={r.id} req={r} />
            ))}
          </ul>
        ) : (
          <p className="border-t border-[var(--lp-border)] px-4 py-6 text-center text-sm text-[var(--lp-subtle)]">{list.isLoading ? "Loading…" : "Nothing to review."}</p>
        )}
      </Panel>
    </div>
  );
}
