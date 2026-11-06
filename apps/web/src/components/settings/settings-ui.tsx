"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* Building blocks shared by the personal and workspace settings pages. */

export function initialsFor(name?: string | null, email?: string | null) {
  const source = (name || email || "QN").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

// Quiet, earthy tones for initials: a background and a matching letter colour.
const AVATAR_TONES: [string, string][] = [
  ["#33413a", "#b9d4c2"], // sage
  ["#463a31", "#e6c6a6"], // clay
  ["#333c4b", "#bccbe0"], // slate
  ["#47363b", "#e8bcc6"], // rose
  ["#423f35", "#dcd2ad"], // sand
  ["#31444a", "#b1d6da"], // teal
  ["#3d3649", "#cfc2e6"], // lavender
  ["#4a392f", "#ecbf98"], // terracotta
];

/** The same person always gets the same tone. */
function toneFor(seed: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

export function Avatar({
  name,
  email,
  src,
  size = 40,
  className,
}: {
  name?: string | null;
  email?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- served by the API behind auth, not a static asset
      <img src={src} alt="" width={size} height={size} className={cn("shrink-0 rounded-full object-cover", className)} style={{ width: size, height: size }} />
    );
  }
  const [background, color] = toneFor((email || name || "").toLowerCase());
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 select-none place-items-center rounded-full font-medium", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background, color, letterSpacing: "0.01em" }}
    >
      {initialsFor(name, email)}
    </span>
  );
}

/**
 * A workspace's mark: its initials on the same quiet tones as people, but on
 * a rounded square, so a workspace never reads as a person.
 */
export function WorkspaceAvatar({ name, id, size = 32, className }: { name?: string | null; id?: number | null; size?: number; className?: string }) {
  const [background, color] = toneFor(`workspace:${id ?? ""}:${(name || "").toLowerCase()}`);
  return (
    <span
      aria-hidden="true"
      className={cn("grid shrink-0 select-none place-items-center font-semibold", className)}
      style={{ width: size, height: size, borderRadius: Math.max(4, Math.round(size * 0.24)), fontSize: Math.round(size * 0.4), background, color }}
    >
      {initialsFor(name)}
    </span>
  );
}

export function SettingsPageTitle({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--lp-border)] pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h1 className="text-[22px] font-medium tracking-[-0.02em]">{title}</h1>
        {description ? <p className="mt-1 text-[13px] leading-relaxed text-[var(--lp-muted)]">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * One setting: title and explanation, the control, and a footer with a hint and
 * its own save action, so changing one thing never submits another.
 */
export function SettingsCard({
  title,
  description,
  children,
  hint,
  action,
  tone = "default",
  onSubmit,
  id,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  tone?: "default" | "danger";
  onSubmit?: () => void;
  id?: string;
}) {
  const body = (
    <>
      <div className="p-5">
        <h2 id={id ? `${id}-title` : undefined} className="text-[15px] font-medium">
          {title}
        </h2>
        {description ? <p className="mt-1 text-[13px] leading-relaxed text-[var(--lp-muted)]">{description}</p> : null}
        {children ? <div className="mt-4">{children}</div> : null}
      </div>
      {hint || action ? (
        <div
          className={cn(
            "flex min-h-[52px] flex-wrap items-center justify-between gap-3 rounded-b-xl border-t px-5 py-2.5",
            tone === "danger" ? "border-[rgba(255,61,127,0.25)] bg-[rgba(255,61,127,0.05)]" : "border-[var(--lp-border)] bg-white/[0.015]",
          )}
        >
          <div className="min-w-0 text-[12px] text-[var(--lp-subtle)]">{hint}</div>
          {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
        </div>
      ) : null}
    </>
  );
  const className = cn(
    "rounded-xl border bg-[#1b1b1f]",
    tone === "danger" ? "border-[rgba(255,61,127,0.3)]" : "border-[var(--lp-border)]",
  );
  if (onSubmit) {
    return (
      <form
        id={id}
        aria-labelledby={id ? `${id}-title` : undefined}
        className={className}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {body}
      </form>
    );
  }
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={className}>
      {body}
    </section>
  );
}

export function Notice({ tone, children }: { tone: "success" | "error" | "info"; children: ReactNode }) {
  const styles = {
    success: "border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] text-[#86efac]",
    error: "border-[rgba(255,61,127,0.3)] bg-[rgba(255,61,127,0.08)] text-[#ff8fb3]",
    info: "border-[rgba(251,191,36,0.3)] bg-[rgba(251,191,36,0.08)] text-[#fcd34d]",
  };
  return (
    <p role={tone === "error" ? "alert" : "status"} className={cn("rounded-lg border px-3 py-2.5 text-[13px]", styles[tone])}>
      {children}
    </p>
  );
}

/** Footer status text: saved, error, or nothing. */
export function SaveState({ saved, error, idle }: { saved?: string | null; error?: string | null; idle?: ReactNode }) {
  if (error) return <span className="text-[#ff8fb3]">{error}</span>;
  if (saved) return <span className="text-[#86efac]">{saved}</span>;
  return <>{idle}</>;
}

export function roleLabel(role?: string) {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "viewer":
      return "Viewer";
    case "member":
      return "Member";
    default:
      return role ?? "—";
  }
}

export function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}
