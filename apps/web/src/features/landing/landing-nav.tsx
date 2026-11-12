"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
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
          onClick={() => setOpen((value) => !value)}
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

      {open ? (
        <div className="lp-container pb-6 lg:hidden">
          <ul className="flex flex-col gap-1 border-t border-[var(--lp-border)] pt-4">
            {nav.flatMap((entry) => ("href" in entry ? [entry] : [])).map((link) => (
              <li key={link.label}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-2 py-2.5 text-[15px] text-[var(--lp-muted)] hover:bg-white/5 hover:text-[var(--lp-text)]"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          {nav.flatMap((entry) => ("items" in entry ? [entry] : [])).map((menu) => (
            <div key={menu.label}>
              <p className="mt-4 px-2 text-[12px] uppercase tracking-wide text-[var(--lp-subtle)]">{menu.label}</p>
              <ul className="mt-1 grid grid-cols-2 gap-1">
                {menu.items.map((item) => (
                  <li key={item.label}>
                    <MenuLink
                      item={item}
                      onPick={() => setOpen(false)}
                      className="block rounded-lg px-2 py-2.5 text-[15px] text-[var(--lp-muted)] hover:bg-white/5 hover:text-[var(--lp-text)]"
                    >
                      {item.label}
                    </MenuLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link href="/login" className="lp-btn lp-btn-secondary">
              Sign in
            </Link>
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Start free
            </Link>
          </div>
        </div>
      ) : null}
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
