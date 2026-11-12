"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookOpenText,
  CaretDown,
  EnvelopeSimple,
  FileCode,
  GithubLogo,
  Info,
  Lightning,
  MapTrifold,
  TerminalWindow,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon as PhIcon } from "@phosphor-icons/react/dist/lib/types";
import { QnetwardMark } from "./qnetward-mark";

type MenuItem = { href: string; label: string; hint: string; icon: PhIcon; external?: boolean; download?: boolean };

const developers: MenuItem[] = [
  { href: "/docs/api", label: "API reference", hint: "Every endpoint, with examples to try", icon: BookOpenText },
  { href: "/openapi.yaml", label: "OpenAPI spec", hint: "For Postman, SDKs, and code generators", icon: FileCode, download: true },
  { href: "/#developers", label: "CLI", hint: "One binary, --json on every command", icon: TerminalWindow },
  { href: "/#developers", label: "Live stream", hint: "Results over a WebSocket as they happen", icon: Lightning },
  { href: "https://github.com/Quantum-Axis/Qnetward", label: "GitHub", hint: "Source code and issues", icon: GithubLogo, external: true },
];

const company: MenuItem[] = [
  { href: "/about", label: "About", hint: "Why we're building Qnetward", icon: Info },
  { href: "/team", label: "Team", hint: "The people behind it", icon: UsersThree },
  { href: "/roadmap", label: "Roadmap", hint: "What's live and what's next", icon: MapTrifold },
  { href: "/about#contact", label: "Contact", hint: "Questions, sales, and support", icon: EnvelopeSimple },
];

type NavLink = { label: string; href: string };
type NavMenuEntry = { label: string; items: MenuItem[]; footer?: NavLink };
type NavEntry = NavLink | NavMenuEntry;

const nav: NavEntry[] = [
  { label: "Product", href: "/#products" },
  { label: "Developers", items: developers, footer: { label: "Building something? Get an API key", href: "/signup" } },
  { label: "Security", href: "/#security" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
  { label: "Company", items: company },
];

function MenuLink({ item, onPick, className, children }: { item: MenuItem; onPick: () => void; className: string; children: React.ReactNode }) {
  if (item.external || item.download) {
    return (
      <a href={item.href} onClick={onPick} className={className} {...(item.external ? { target: "_blank", rel: "noreferrer" } : { download: "" })}>
        {children}
      </a>
    );
  }
  return (
    <Link href={item.href} onClick={onPick} className={className}>
      {children}
    </Link>
  );
}

// A dropdown in the top bar: opens on hover or click, closes on Escape, a
// click outside, leaving it, or a new page, and works from the keyboard.
function NavMenu({ label, items, footer }: NavMenuEntry) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathname = usePathname();
  const [shownOn, setShownOn] = useState(pathname);
  if (shownOn !== pathname) {
    setShownOn(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hold = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const release = () => {
    timer.current = setTimeout(() => setOpen(false), 120);
  };
  const close = () => setOpen(false);

  return (
    <div ref={ref} className="relative" onMouseEnter={hold} onMouseLeave={release}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm text-[color:var(--lp-muted)] transition-colors hover:text-[color:var(--lp-text)] aria-expanded:text-[color:var(--lp-text)]"
      >
        {label}
        <CaretDown size={12} weight="bold" className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div className="absolute left-1/2 top-full z-50 w-[340px] -translate-x-1/2 pt-3">
          <div className="overflow-hidden rounded-xl border border-[var(--lp-border)] bg-[#17171b] shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
            <ul className="p-1.5">
              {items.map((item) => (
                <li key={item.label}>
                  <MenuLink
                    item={item}
                    onPick={close}
                    className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.05] focus-visible:bg-white/[0.05]"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--lp-border)] text-[var(--lp-muted)] group-hover:text-[var(--lp-accent)]">
                      <item.icon size={16} weight="bold" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-[14px] text-[var(--lp-text)]">
                        {item.label}
                        {item.external ? <span className="ml-1 text-[var(--lp-subtle)]">↗</span> : null}
                      </span>
                      <span className="block text-[12.5px] text-[var(--lp-subtle)]">{item.hint}</span>
                    </span>
                  </MenuLink>
                </li>
              ))}
            </ul>
            {footer ? (
              <Link
                href={footer.href}
                onClick={close}
                className="flex items-center justify-between border-t border-[var(--lp-border)] bg-white/[0.02] px-4 py-3 text-[13px] text-[var(--lp-muted)] transition-colors hover:text-[var(--lp-text)]"
              >
                {footer.label}
                <span aria-hidden>→</span>
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// The phone menu: a full-height sheet under the bar, in the same order as the
// desktop nav, with Developers and Company folded until tapped. The page
// behind it doesn't scroll, and Escape or a new page closes it. It renders
// into the page wrapper, outside the bar: the bar's backdrop blur would
// otherwise trap a fixed child, and the wrapper carries the site's fonts.
function MobileMenu({ top, container, onClose }: { top: number; container: HTMLElement; onClose: () => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const row = "flex w-full items-center justify-between rounded-xl px-3 py-3.5 text-[16px] text-[var(--lp-text)] transition-colors active:bg-white/[0.06] hover:bg-white/[0.04]";

  return createPortal(
    <div
      id="mobile-menu"
      className="fixed inset-x-0 bottom-0 z-40 flex flex-col border-t border-[var(--lp-border)] bg-[rgb(20,20,23)] lg:hidden"
      style={{ top }}
    >
      <nav aria-label="Main" className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <ul className="flex flex-col">
          {nav.map((entry) => {
            if ("href" in entry) {
              return (
                <li key={entry.label}>
                  <a href={entry.href} onClick={onClose} className={row}>
                    {entry.label}
                  </a>
                </li>
              );
            }
            const isOpen = expanded === entry.label;
            return (
              <li key={entry.label}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`mobile-${entry.label}`}
                  onClick={() => setExpanded(isOpen ? null : entry.label)}
                  className={row}
                >
                  {entry.label}
                  <CaretDown size={16} weight="bold" aria-hidden className={`text-[var(--lp-subtle)] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen ? (
                  <ul id={`mobile-${entry.label}`} className="mb-2 ml-3 mt-0.5 border-l border-[var(--lp-border)] pl-2">
                    {entry.items.map((item) => (
                      <li key={item.label}>
                        <MenuLink item={item} onPick={onClose} className="flex items-center gap-3 rounded-xl px-3 py-2.5 active:bg-white/[0.06] hover:bg-white/[0.04]">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--lp-border)] text-[var(--lp-muted)]">
                            <item.icon size={17} weight="bold" aria-hidden />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[15px] text-[var(--lp-text)]">
                              {item.label}
                              {item.external ? <span className="ml-1 text-[var(--lp-subtle)]">↗</span> : null}
                            </span>
                            <span className="block truncate text-[13px] text-[var(--lp-subtle)]">{item.hint}</span>
                          </span>
                        </MenuLink>
                      </li>
                    ))}
                    {entry.footer ? (
                      <li>
                        <Link href={entry.footer.href} onClick={onClose} className="flex items-center justify-between rounded-xl px-3 py-2.5 text-[14px] text-[var(--lp-muted)]">
                          {entry.footer.label}
                          <span aria-hidden>→</span>
                        </Link>
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
          <li>
            <a href="https://github.com/Quantum-Axis/Qnetward" target="_blank" rel="noreferrer" onClick={onClose} className={row}>
              <span className="flex items-center gap-2.5">
                <GitHubIcon size={17} /> GitHub
              </span>
              <span className="text-[var(--lp-subtle)]" aria-hidden>
                ↗
              </span>
            </a>
          </li>
        </ul>
      </nav>
      <div className="grid grid-cols-2 gap-3 border-t border-[var(--lp-border)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        <Link href="/login" onClick={onClose} className="lp-btn lp-btn-secondary h-11">
          Sign in
        </Link>
        <Link href="/signup" onClick={onClose} className="lp-btn lp-btn-primary h-11">
          Start free
        </Link>
      </div>
    </div>,
    container,
  );
}

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [menuTop, setMenuTop] = useState(64);
  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null);
  const headerRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }
  const toggleMenu = () => {
    // The sheet starts where the bar ends, wherever the page is scrolled to.
    if (!open && headerRef.current) {
      setMenuTop(headerRef.current.getBoundingClientRect().bottom);
      setMenuHost(headerRef.current.closest<HTMLElement>(".lp-root") ?? document.body);
    }
    setOpen((value) => !value);
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-50 transition-colors"
      style={{
        background: scrolled || open ? "rgba(20, 20, 23, 0.85)" : "transparent",
        backdropFilter: scrolled || open ? "blur(12px)" : undefined,
        borderBottom: `1px solid ${scrolled || open ? "var(--lp-border)" : "transparent"}`,
      }}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-black"
      >
        Skip to content
      </a>
      <nav className="lp-container flex h-16 items-center gap-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Qnetward home">
          <QnetwardMark size={26} />
          <span className="text-[17px] font-semibold tracking-tight">Qnetward</span>
        </Link>

        <ul className="hidden items-center gap-6 lg:flex">
          {nav.map((entry) => (
            <li key={entry.label}>
              {"items" in entry ? (
                <NavMenu label={entry.label} items={entry.items} footer={entry.footer} />
              ) : (
                <a href={entry.href} className="text-sm text-[color:var(--lp-muted)] transition-colors hover:text-[color:var(--lp-text)]">
                  {entry.label}
                </a>
              )}
            </li>
          ))}
        </ul>

        <div className="ml-auto hidden items-center gap-3 lg:flex">
          <a
            href="https://github.com/Quantum-Axis/Qnetward"
            target="_blank"
            rel="noreferrer"
            className="flex h-9 items-center gap-2 rounded-lg border border-[var(--lp-border)] px-3 text-sm text-[color:var(--lp-muted)] transition-colors hover:text-[color:var(--lp-text)]"
          >
            <GitHubIcon />
            GitHub
          </a>
          <Link href="/login" className="lp-btn lp-btn-secondary h-9">
            Sign in
          </Link>
          <Link href="/signup" className="lp-btn lp-btn-primary h-9">
            Start free
          </Link>
        </div>

        <button
          type="button"
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--lp-border)] lg:hidden"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={toggleMenu}
        >
          <span className="relative block h-3 w-4">
            <span
              className="absolute left-0 h-px w-4 bg-current transition-transform"
              style={{ top: open ? 6 : 0, transform: open ? "rotate(45deg)" : undefined }}
            />
            <span className="absolute left-0 top-1.5 h-px w-4 bg-current" style={{ opacity: open ? 0 : 1 }} />
            <span
              className="absolute left-0 h-px w-4 bg-current transition-transform"
              style={{ top: open ? 6 : 12, transform: open ? "rotate(-45deg)" : undefined }}
            />
          </span>
        </button>
      </nav>

      {open && menuHost ? <MobileMenu top={menuTop} container={menuHost} onClose={() => setOpen(false)} /> : null}
    </header>
  );
}

export function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
