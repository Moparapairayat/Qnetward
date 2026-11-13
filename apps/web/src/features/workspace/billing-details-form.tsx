"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ApiError } from "@/lib/api";
import type { BillingDetails } from "@/lib/types";

// Where most customers pay from, then the rest alphabetically.
const COUNTRIES: [string, string][] = [
  ["BD", "Bangladesh"],
  ["AU", "Australia"],
  ["CA", "Canada"],
  ["DE", "Germany"],
  ["IN", "India"],
  ["MY", "Malaysia"],
  ["NP", "Nepal"],
  ["PK", "Pakistan"],
  ["SA", "Saudi Arabia"],
  ["SG", "Singapore"],
  ["LK", "Sri Lanka"],
  ["AE", "United Arab Emirates"],
  ["GB", "United Kingdom"],
  ["US", "United States"],
];

function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm text-[var(--lp-text)]">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-[var(--lp-subtle)]">{hint}</p> : null}
    </div>
  );
}

/**
 * Who this workspace's payments are from. The name and phone go to the payment
 * gateway, which needs a phone; company and address only appear on receipts.
 * compact shows just what checkout needs, for the dialog before paying.
 */
export function BillingDetailsForm({
  initial,
  compact = false,
  disabled = false,
  submitLabel = "Save",
  onSaved,
  footer,
}: {
  initial: BillingDetails;
  compact?: boolean;
  disabled?: boolean;
  submitLabel?: string;
  onSaved?: (saved: BillingDetails) => void;
  /** Rendered beside the submit button, such as a Cancel button. */
  footer?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BillingDetails>(initial);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const set = (key: keyof BillingDetails) => (e: { target: { value: string } }) => {
    setSavedAt(null);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  const save = useMutation({
    mutationFn: () => apiRequest<BillingDetails>("/api/billing/details", { method: "PUT", body: JSON.stringify(form) }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["billing-details"], saved);
      setForm(saved);
      setSavedAt(Date.now());
      onSaved?.(saved);
    },
  });

  const bd = form.country === "BD";
  const input = "h-9 w-full px-3";
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="grid gap-4"
    >
      <div className={compact ? "grid gap-4" : "grid gap-4 sm:grid-cols-2"}>
        <Field id="billing-name" label="Billing name" hint="Your name or your company's. It's shown on the payment page and receipts.">
          <input id="billing-name" className={input} autoComplete="name" maxLength={100} value={form.name} onChange={set("name")} disabled={disabled} required />
        </Field>
        <Field id="billing-phone" label="Phone" hint={bd ? "The number you'll pay from, like 01712345678." : "With the country code, like +44 20 7946 0958."}>
          <input
            id="billing-phone"
            className={input}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={20}
            value={form.phone}
            onChange={set("phone")}
            disabled={disabled}
            required
          />
        </Field>
        <Field id="billing-country" label="Country">
          <select id="billing-country" className={input} value={form.country || "BD"} onChange={set("country")} disabled={disabled}>
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        {compact ? null : (
          <>
            <Field id="billing-company" label="Company" hint="Optional.">
              <input id="billing-company" className={input} autoComplete="organization" maxLength={120} value={form.company} onChange={set("company")} disabled={disabled} />
            </Field>
            <Field id="billing-address" label="Address" hint="Optional, for receipts.">
              <input id="billing-address" className={input} autoComplete="street-address" maxLength={200} value={form.address} onChange={set("address")} disabled={disabled} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field id="billing-city" label="City">
                <input id="billing-city" className={input} autoComplete="address-level2" maxLength={80} value={form.city} onChange={set("city")} disabled={disabled} />
              </Field>
              <Field id="billing-postcode" label="Postcode">
                <input id="billing-postcode" className={input} autoComplete="postal-code" maxLength={20} value={form.postcode} onChange={set("postcode")} disabled={disabled} />
              </Field>
            </div>
          </>
        )}
      </div>
      {save.isError ? <p className="text-sm text-[#ff8fb3]">{(save.error as ApiError).message}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {savedAt && !compact ? <span className="mr-auto text-xs text-[#86efac]">Saved</span> : null}
        {footer}
        <button type="submit" className="console-btn console-btn-primary h-9 px-4" disabled={disabled || save.isPending}>
          {save.isPending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
