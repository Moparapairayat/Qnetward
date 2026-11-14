"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Lock } from "@/components/icons";
import { apiRequest, ApiError } from "@/lib/api";
import { proPricing, type Period, type PlanId } from "@/lib/plans";
import type { BillingDetails, BillingResponse, PublicPlansResponse } from "@/lib/types";
import { Modal } from "@/components/ui/modal";
import { BillingDetailsForm } from "@/features/workspace/billing-details-form";
import { formatDate } from "@/components/settings/settings-ui";
import { Pricing } from "@/features/landing/pricing";

// The workspace record still uses the pre-launch plan names.
function planFor(stored?: string): PlanId {
  if (stored === "pro") return "pro";
  if (stored === "enterprise") return "enterprise";
  return "free";
}

const button = "lp-btn w-full disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Plans, full width: the same cards as the pricing page, with buttons that buy
 * Pro for this workspace. Billing and plan links here; so does the pricing
 * page, through signup.
 */
export function UpgradeWorkspace() {
  const params = useSearchParams();
  const defaultPeriod: Period = params.get("period") === "monthly" ? "monthly" : "yearly";

  const billingQuery = useQuery({ queryKey: ["workspace-billing"], queryFn: () => apiRequest<BillingResponse>("/api/billing") });
  const plansQuery = useQuery({ queryKey: ["public-plans"], queryFn: () => apiRequest<PublicPlansResponse>("/api/plans"), staleTime: 300_000 });
  const billing = billingQuery.data;
  const current = planFor(billing?.plan);
  const pro = proPricing((billing?.prices ?? []).filter((p) => p.plan === "pro"));

  const detailsQuery = useQuery({
    queryKey: ["billing-details"],
    queryFn: () => apiRequest<BillingDetails>("/api/billing/details"),
    enabled: billing?.can_pay === true,
  });
  // The months waiting on billing details: the payment gateway needs a phone
  // number, so the first purchase asks for one, then carries on to pay.
  const [askDetailsFor, setAskDetailsFor] = useState<number | null>(null);

  const checkout = useMutation({
    mutationFn: (months: number) => apiRequest<{ payment_url: string }>("/api/billing/checkout", { method: "POST", body: JSON.stringify({ plan: "pro", months }) }),
    onSuccess: (resp) => window.location.assign(resp.payment_url),
    onError: (err: ApiError, months) => {
      if ((err.payload as { billing_details_required?: boolean } | undefined)?.billing_details_required) setAskDetailsFor(months);
    },
  });
  const buy = (months: number) => {
    if (detailsQuery.data && !detailsQuery.data.phone) {
      setAskDetailsFor(months);
      return;
    }
    checkout.mutate(months);
  };

  const action = (id: PlanId, period: Period) => {
    if (id === "free") {
      return (
        <button type="button" className={`${button} lp-btn-secondary`} disabled>
          {current === "free" ? "Your current plan" : "Included with every workspace"}
        </button>
      );
    }
    if (id === "enterprise") {
      return current === "enterprise" ? (
        <button type="button" className={`${button} lp-btn-secondary`} disabled>
          Your current plan
        </button>
      ) : (
        <a href="mailto:sales@qnetward.com?subject=Qnetward%20Enterprise" className={`${button} lp-btn-secondary`}>
          Contact sales
        </a>
      );
    }
    if (current === "enterprise") {
      return (
        <button type="button" className={`${button} lp-btn-secondary`} disabled>
          Included in Enterprise
        </button>
      );
    }
    // The period shown on the card, or whichever one the server sells.
    const choice = (period === "yearly" ? pro.yearly : pro.monthly) ?? pro.monthly ?? pro.yearly;
    if (!billing?.payments_enabled || !choice) {
      return (
        <button type="button" className={`${button} lp-btn-secondary`} disabled title="Online payment isn't set up on this server yet">
          <Lock className="h-4 w-4" /> Not available yet
        </button>
      );
    }
    return (
      <>
        <button
          type="button"
          className={`${button} lp-btn-primary`}
          disabled={!billing.can_pay || checkout.isPending}
          onClick={() => buy(choice.months)}
        >
          {checkout.isPending ? "Opening checkout…" : current === "pro" ? `Add ${choice.months === 12 ? "a year" : "a month"} of Pro` : "Upgrade to Pro"}
        </button>
        {!billing.can_pay ? <p className="mt-2 text-center text-xs text-[var(--lp-subtle)]">Only workspace owners and admins can pay.</p> : null}
        {checkout.isError && askDetailsFor === null ? <p className="mt-2 text-center text-xs text-[#ff8fb3]">{(checkout.error as ApiError).message}</p> : null}
      </>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-8">
      <div>
        <Link href="/workspace/billing" className="-my-1.5 inline-flex items-center gap-1.5 py-1.5 text-sm text-[var(--lp-muted)] hover:text-[var(--lp-text)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Billing and plan
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em]">Plans</h1>
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-[var(--lp-muted)]">
          {current === "pro" && billing?.plan_expires_at
            ? `This workspace is on Pro, paid through ${formatDate(billing.plan_expires_at)}. Buying more adds to the end of it.`
            : "Pro is paid ahead, a month or a year at a time, and never renews by itself. When it ends, the workspace goes back to Free and keeps everything; what Free doesn't cover waits until you pay again."}
        </p>
      </div>
      {billingQuery.isError ? <p className="text-sm text-[#ff8fb3]">{(billingQuery.error as ApiError).message || "Couldn't load this workspace's plan."}</p> : null}
      <Pricing initial={plansQuery.data ?? null} defaultPeriod={defaultPeriod} current={billing ? current : undefined} renderAction={action} />

      <Modal
        open={askDetailsFor !== null}
        onClose={() => setAskDetailsFor(null)}
        title="Billing details"
        description="The payment page needs your name and the phone number you'll pay from. You only do this once."
        className="max-w-[480px]"
      >
        {askDetailsFor !== null && detailsQuery.data ? (
          <BillingDetailsForm
            compact
            initial={detailsQuery.data}
            submitLabel="Continue to payment"
            onSaved={() => {
              const months = askDetailsFor;
              setAskDetailsFor(null);
              checkout.mutate(months);
            }}
            footer={
              <button type="button" className="console-btn console-btn-secondary h-9 px-4" onClick={() => setAskDetailsFor(null)}>
                Cancel
              </button>
            }
          />
        ) : null}
      </Modal>
    </div>
  );
}
