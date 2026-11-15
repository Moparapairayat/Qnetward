"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpenText, Books, Check, Copy, ListBullets, MagnifyingGlass, TerminalWindow } from "@phosphor-icons/react/dist/ssr";
import type { Icon as PhIcon } from "@phosphor-icons/react/dist/lib/types";
import { ArrowUpRight } from "@/components/icons";
import { QnetwardMark } from "@/features/landing/qnetward-mark";
import { allPages, sectionFor, sections, type SectionId } from "./docs-nav";

const tabIcons: Record<SectionId, PhIcon> = { docs: BookOpenText, guides: Books, reference: TerminalWindow };

/** The bar across every docs page: the logo, the three sections, and the console. */
export function DocsHeader({ onMenu, menuOpen }: { onMenu?: () => void; menuOpen?: boolean }) {
  const pathname = usePathname();
  const current = sectionFor(pathname);
  return (
    <header className="sticky top-0 z-50 bg-[var(--d-bg)]">
      <div className="flex h-14 items-center gap-6 px-4 lg:px-6">
        <Link href="/" className="flex w-auto items-center gap-2 lg:w-[236px]" aria-label="Qnetward home">
          <QnetwardMark size={22} />
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--d-text)]">Qnetward</span>
        </Link>
        <nav className="hidden items-center gap-6 md:flex" aria-label="Docs sections">
          {sections.map((s) => {
            const Icon = tabIcons[s.id];
            const active = s.id === current.id;
            return (
              <Link
                key={s.id}
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 text-[14px] leading-5 transition-colors ${active ? "font-medium text-[var(--d-text)]" : "text-[var(--d-muted)] hover:text-[var(--d-text)]"}`}
              >
                <Icon size={16} weight={active ? "bold" : "regular"} aria-hidden />
                {s.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-[14px]">
          <Link
            href="/workspace/api-keys"
            className="hidden h-8 items-center rounded-lg border border-[var(--d-border)] px-3 text-[var(--d-muted)] transition-colors hover:text-[var(--d-text)] sm:inline-flex"
          >
            Get an API key
          </Link>
          <Link href="/overview" className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--d-text)] px-3 font-medium text-[#0b0b0d] transition-colors hover:bg-white">
            Console <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          {onMenu ? (
            <button
              type="button"
              onClick={onMenu}
              aria-expanded={menuOpen}
              aria-controls="docs-sidebar"
              className="h-8 rounded-lg border border-[var(--d-border)] px-3 text-[var(--d-muted)] lg:hidden"
            >
              {menuOpen ? "Close" : "Menu"}
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}

/** Ctrl K: find any page in the docs by its title. */
function SearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? allPages.filter((p) => p.label.toLowerCase().includes(q) || p.section.toLowerCase().includes(q)) : allPages;
  }, [query]);

  useEffect(() => {
    input.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search the docs"
        className="docs-pop w-full max-w-[560px] overflow-hidden rounded-2xl border border-[var(--d-border-strong)] bg-[var(--d-raised)] shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--d-border)] px-4">
          <MagnifyingGlass size={16} className="text-[var(--d-subtle)]" aria-hidden />
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter" && results[index]) go(results[index].href);
            }}
            placeholder="Search the docs…"
            className="h-12 flex-1 bg-transparent text-[15px] text-[var(--d-text)] outline-none placeholder:text-[var(--d-subtle)]"
          />
          <kbd className="docs-mono rounded border border-[var(--d-border)] px-1.5 text-[11px] text-[var(--d-subtle)]">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
          {results.length ? (
            results.map((p, i) => (
              <li key={p.href} role="option" aria-selected={i === index}>
                <button
                  type="button"
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => go(p.href)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[14px] ${i === index ? "bg-white/[0.06] text-[var(--d-text)]" : "text-[var(--d-muted)]"}`}
                >
                  {p.label}
                  <span className="text-[12px] text-[var(--d-subtle)]">{p.section}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-6 text-center text-[14px] text-[var(--d-subtle)]">Nothing matches “{query}”.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

/** Documentation and Guides: header, sidebar, and the page in a raised panel. */
export function DocsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const section = sectionFor(pathname);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [openedOn, setOpenedOn] = useState(pathname);
  if (openedOn !== pathname) {
    setOpenedOn(pathname);
    setOpen(false);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearching(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const order = section.groups.flatMap((g) => g.items);
  const index = order.findIndex((g) => g.href === pathname);
  const prev = index > 0 ? order[index - 1] : null;
  const next = index >= 0 && index < order.length - 1 ? order[index + 1] : null;

  return (
    <>
      <DocsHeader onMenu={() => setOpen((v) => !v)} menuOpen={open} />
      <div className="flex">
        <aside
          id="docs-sidebar"
          className={`${open ? "fixed inset-x-0 bottom-0 top-14 z-40 block bg-[var(--d-bg)]" : "hidden"} overflow-y-auto px-4 pb-8 pt-2 lg:sticky lg:top-14 lg:block lg:h-[calc(100dvh-56px)] lg:w-[260px] lg:shrink-0`}
        >
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="flex h-9 w-full items-center gap-2.5 rounded-xl border border-[var(--d-border)] bg-[var(--d-raised)] px-3 text-[14px] text-[var(--d-subtle)] transition-colors hover:border-[var(--d-border-strong)]"
          >
            <MagnifyingGlass size={15} aria-hidden />
            Search…
            <kbd className="docs-mono ml-auto text-[11px]">Ctrl K</kbd>
          </button>

          {/* On phones the sections live here too. */}
          <div className="mt-4 flex flex-col gap-1 md:hidden">
            {sections.map((s) => {
              const Icon = tabIcons[s.id];
              return (
                <Link key={s.id} href={s.href} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] ${s.id === section.id ? "bg-white/[0.06] text-[var(--d-text)]" : "text-[var(--d-muted)]"}`}>
                  <Icon size={16} aria-hidden /> {s.label}
                </Link>
              );
            })}
          </div>

          <nav className="mt-6 flex flex-col gap-7" aria-label={section.label}>
            {section.groups.map((g) => (
              <div key={g.title}>
                <p className="mb-2 px-4 text-[14px] font-semibold leading-5 text-[var(--d-text)]">{g.title}</p>
                <ul className="flex flex-col gap-0.5">
                  {g.items.map((item) => (
                    <li key={item.href}>
                      <Link href={item.href} className="docs-side-link" aria-current={pathname === item.href ? "page" : undefined}>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <main id="main" className="docs-panel min-w-0 flex-1">
          <div className="px-5 pb-24 pt-10 sm:px-10 lg:pt-14">
            {children}
            {prev || next ? (
              <nav className="mx-auto mt-16 max-w-[940px]" aria-label="More pages">
                <div className="grid max-w-[656px] gap-3 sm:grid-cols-2">
                {prev ? (
                  <Link href={prev.href} className="docs-card">
                    <span className="block text-[13px] text-[var(--d-subtle)]">Previous</span>
                    <span className="mt-1 block text-[15px] font-medium text-[var(--d-text)]">← {prev.label}</span>
                  </Link>
                ) : (
                  <span />
                )}
                {next ? (
                  <Link href={next.href} className="docs-card text-right">
                    <span className="block text-[13px] text-[var(--d-subtle)]">Next</span>
                    <span className="mt-1 block text-[15px] font-medium text-[var(--d-text)]">{next.label} →</span>
                  </Link>
                ) : null}
                </div>
              </nav>
            ) : null}
          </div>
        </main>
      </div>
      {searching ? <SearchDialog onClose={() => setSearching(false)} /> : null}
    </>
  );
}

/** Copies the page's text, for pasting into a ticket or an assistant. */
export function CopyPage() {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        const text = document.querySelector("article")?.innerText ?? "";
        void navigator.clipboard?.writeText(`${text}\n\nSource: ${window.location.href}`).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        });
      }}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--d-border)] px-2.5 text-[13px] text-[var(--d-muted)] transition-colors hover:border-[var(--d-border-strong)] hover:text-[var(--d-text)]"
    >
      {done ? <Check size={14} className="text-[#86efac]" aria-hidden /> : <Copy size={14} aria-hidden />}
      {done ? "Copied" : "Copy page"}
    </button>
  );
}

/** "On this page": follows the section in view. */
export function Toc({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (seen[0]) setActive(seen[0].target.id);
      },
      { rootMargin: "-80px 0px -65% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items]);
  if (!items.length) return null;
  return (
    <nav aria-label="On this page" className="sticky top-24 hidden w-[220px] shrink-0 self-start xl:block">
      <p className="mb-3 flex items-center gap-2 text-[14px] font-medium text-[var(--d-text)]">
        <ListBullets size={15} aria-hidden /> On this page
      </p>
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <a href={`#${i.id}`} className="docs-toc-link" data-active={active === i.id}>
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
