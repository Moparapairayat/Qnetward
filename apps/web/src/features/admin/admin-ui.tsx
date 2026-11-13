"use client";

import { ReactNode } from "react";
import { Search } from "@/components/icons";
import { cn } from "@/lib/utils";

/* Small pieces shared by the platform admin pages. */

export function timeAgo(value?: string | null) {
  if (!value) return "—";
  const ts = new Date(value).getTime();
  if (Number.isNaN(ts)) return "—";
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

export function Pill({ tone = "muted", children }: { tone?: "good" | "warn" | "bad" | "accent" | "muted"; children: ReactNode }) {
  const styles = {
    good: "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]",
    warn: "border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.08)] text-[#fcd34d]",
    bad: "border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] text-[#ff8fb3]",
    accent: "border-[rgba(167,139,250,0.3)] bg-[rgba(167,139,250,0.1)] text-[#c4b5fd]",
    muted: "border-[var(--lp-border)] bg-white/[0.03] text-[var(--lp-muted)]",
  };
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-px text-2xs", styles[tone])}>{children}</span>;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative">
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--lp-subtle)]" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8 w-56 pl-8 pr-2 text-sm" />
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; count?: number }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="flex rounded-lg border border-[var(--lp-border)] p-0.5" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs transition-colors",
            value === o.id ? "bg-white/[0.08] text-[var(--lp-text)]" : "text-[var(--lp-muted)] hover:text-[var(--lp-text)]",
          )}
        >
          {o.label}
          {typeof o.count === "number" ? <span className="ml-1 text-[var(--lp-subtle)]">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Th({ children, align = "left", className }: { children?: ReactNode; align?: "left" | "right"; className?: string }) {
  return <th className={cn("px-4 py-2 font-medium", align === "right" && "text-right", className)}>{children}</th>;
}

export function Td({ children, align = "left", className }: { children?: ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={cn("px-4 py-2.5", align === "right" && "text-right", className)}>{children}</td>;
}

export function TableShell({ children, minWidth = 760 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto border-t border-[var(--lp-border)]">
      <table className="w-full text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function HeadRow({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-[var(--lp-border)] bg-white/[0.015] text-left text-xs text-[var(--lp-subtle)]">{children}</tr>
    </thead>
  );
}
