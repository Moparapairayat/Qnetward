import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { CopyPage, Toc } from "./docs-shell";

/** A guide: the text column, and "On this page" beside it on wide screens. */
export function Article({ toc, children }: { toc: { id: string; label: string }[]; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-[940px] gap-16">
      <article className="docs-prose docs-enter min-w-0 max-w-[656px] flex-1">{children}</article>
      <Toc items={toc} />
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-[14px] leading-5 text-[var(--d-muted)]">{children}</p>;
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <h1 className="text-[30px] font-semibold leading-[36px] tracking-[-0.75px] sm:text-[36px] sm:leading-[40px] sm:tracking-[-0.9px]">{children}</h1>
      <span className="mt-1 hidden sm:block">
        <CopyPage />
      </span>
    </div>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[18px] leading-7 text-[var(--d-muted)]">{children}</p>;
}

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="docs-h2 mt-12 text-[24px] font-semibold leading-8 tracking-[-0.6px]">
      {children}
      <a href={`#${id}`} className="docs-anchor" aria-label="Link to this section">
        #
      </a>
    </h2>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-8 text-[18px] font-semibold leading-7 tracking-[-0.3px]">{children}</h3>;
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[16px] leading-7 text-[#c4c4cc]">{children}</p>;
}

export function C({ children }: { children: ReactNode }) {
  return <code className="docs-inline">{children}</code>;
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  return href.startsWith("http") ? (
    <a href={href} className="docs-link" target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <Link href={href} className="docs-link">
      {children}
    </Link>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <ul className="mt-4 flex list-none flex-col gap-2 text-[16px] leading-7 text-[#c4c4cc] [&>li]:relative [&>li]:pl-5 [&>li]:before:absolute [&>li]:before:left-1 [&>li]:before:top-[0.7em] [&>li]:before:h-1 [&>li]:before:w-1 [&>li]:before:rounded-full [&>li]:before:bg-[var(--d-subtle)]">{children}</ul>;
}

/** Space above a code sample or table inside the prose. */
export function Block({ children }: { children: ReactNode }) {
  return <div className="mt-5">{children}</div>;
}

export function Endpoint({ method, path }: { method: "GET" | "POST" | "DELETE"; path: string }) {
  return (
    <div className="mt-5 inline-flex items-center gap-2.5 rounded-lg border border-[var(--d-border)] bg-[var(--d-raised)] py-1.5 pl-1.5 pr-3">
      <span className={`docs-method docs-method-${method.toLowerCase()}`}>{method}</span>
      <span className="docs-mono text-[13px] text-[var(--d-text)]">{path}</span>
    </div>
  );
}

export function Callout({ tone = "note", title, children }: { tone?: "note" | "warn"; title: string; children: ReactNode }) {
  const bar = tone === "warn" ? "bg-[#fbbf24]" : "bg-[var(--d-accent)]";
  return (
    <div className="relative mt-6 overflow-hidden rounded-xl border border-[var(--d-border)] bg-[var(--d-raised)] py-4 pl-5 pr-5">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${bar}`} aria-hidden />
      <p className="text-[14px] font-medium text-[var(--d-text)]">{title}</p>
      <div className="mt-1 text-[14px] leading-relaxed text-[var(--d-muted)]">{children}</div>
    </div>
  );
}

export type Row = { name: string; type?: string; required?: boolean; children: ReactNode };

/** Fields or values, one per row: name and type on the left, meaning on the right. */
export function Fields({ rows }: { rows: Row[] }) {
  return (
    <dl className="mt-5 divide-y divide-[var(--d-border)] border-y border-[var(--d-border)]">
      {rows.map((r) => (
        <div key={r.name} className="grid gap-1 py-3.5 sm:grid-cols-[200px_1fr] sm:gap-6">
          <dt className="flex flex-wrap items-baseline gap-2">
            <span className="docs-mono text-[13px] text-[var(--d-text)]">{r.name}</span>
            {r.type ? <span className="docs-mono text-[12px] text-[var(--d-subtle)]">{r.type}</span> : null}
            {r.required ? <span className="text-[11px] font-medium text-[var(--d-accent)]">required</span> : null}
          </dt>
          <dd className="text-[14px] leading-relaxed text-[var(--d-muted)]">{r.children}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="docs-steps mt-8">{children}</ol>;
}

export function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="docs-step">
      <h3 className="pt-0.5 text-[17px] font-semibold leading-7">{title}</h3>
      <div className="[&>*:first-child]:mt-2">{children}</div>
    </li>
  );
}

export function Cards({ children }: { children: ReactNode }) {
  return <div className="mt-6 grid gap-4 sm:grid-cols-2">{children}</div>;
}

export function Card({ href, title, icon: Icon, children }: { href: string; title: string; icon: ComponentType<{ className?: string }>; children: ReactNode }) {
  return (
    <Link href={href} className="docs-card group">
      <Icon className="h-6 w-6 text-[var(--d-text)]" />
      <span className="mt-4 flex items-center gap-2 text-[16px] font-semibold leading-6 text-[var(--d-text)]">
        {title}
        <span className="docs-card-arrow text-[var(--d-subtle)]" aria-hidden>
          →
        </span>
      </span>
      <span className="mt-1 block text-[14px] leading-[22px] text-[var(--d-muted)]">{children}</span>
    </Link>
  );
}
