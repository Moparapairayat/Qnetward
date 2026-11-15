"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BellRinging,
  BookOpenText,
  CaretDown,
  ClockCounterClockwise,
  EnvelopeSimple,
  GithubLogo,
  GlobeHemisphereWest,
  Info,
  MapTrifold,
  Plugs,
  Pulse,
  Question,
  ShieldCheck,
  TerminalWindow,
  UsersThree,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon as PhIcon } from "@phosphor-icons/react/dist/lib/types";
import { siCurl, siDiscord, siDocker, siExpress, siGithubactions, siGo, siNextdotjs, siNodedotjs, siOpenapiinitiative, siPython, siTelegram } from "simple-icons";
import { QnetwardMark } from "./qnetward-mark";

type MenuItem = { href: string; label: string; hint: string; icon: PhIcon; external?: boolean; download?: boolean };

const product: MenuItem[] = [
  { href: "/#products", label: "Diagnostics", hint: "Ping, port scan, DNS, and traceroute", icon: Pulse },
  { href: "/#products", label: "Uptime monitors", hint: "Checks that run with the tab closed", icon: Pulse },
  { href: "/#integrations", label: "Alerts", hint: "Slack, Discord, Telegram, and webhooks", icon: BellRinging },
  { href: "/#security", label: "Security", hint: "Scans gated by proof and consent", icon: ShieldCheck },
  { href: "/#network", label: "Global network", hint: "Probe from more than one place", icon: GlobeHemisphereWest },
];

const productCards: MenuItem[] = [
  { href: "/#features", label: "Every tool", hint: "All in one console", icon: Pulse },
  { href: "/#integrations", label: "Alert channels", hint: "Slack, Discord, and more", icon: Plugs },
];

const docs: MenuItem[] = [
  { href: "/docs", label: "Getting started", hint: "Your first request in five minutes", icon: BookOpenText },
  { href: "/docs/api", label: "API reference", hint: "Every endpoint, with examples to try", icon: TerminalWindow },
  { href: "/#integrations", label: "Integrations", hint: "Slack, Discord, Telegram, and webhooks", icon: Plugs },
  { href: "/changelog", label: "Changelog", hint: "What shipped, newest first", icon: ClockCounterClockwise },
];

const company: MenuItem[] = [
  { href: "/about", label: "About", hint: "Why we're building Qnetward", icon: Info },
  { href: "/team", label: "Team", hint: "The people behind it", icon: UsersThree },
  { href: "/about#contact", label: "Contact", hint: "Questions, sales, and support", icon: EnvelopeSimple },
  { href: "/#faq", label: "FAQ", hint: "Common questions", icon: Question },
];

const companyCards: MenuItem[] = [
  { href: "/roadmap", label: "Roadmap", hint: "What's live and next", icon: MapTrifold },
  { href: "https://github.com/Quantum-Axis/Qnetward", label: "Open source", hint: "AGPL-3.0, on GitHub", icon: GithubLogo, external: true },
];

// A single-colour mark, as Simple Icons draws them.
type Mark = { slug: string; title: string; path: string };

// Simple Icons no longer carries Slack, so its mark comes from our own logo file.
const slack: Mark = { slug: "slack", title: "Slack", path: "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" };

// First row: where alerts go and CI. Then the languages and tools the docs have examples for.
const docsStack: Mark[] = [slack, siDiscord, siTelegram, siGithubactions, siNodedotjs, siNextdotjs, siExpress, siPython, siGo, siCurl, siDocker, siOpenapiinitiative];

type NavLink = { label: string; href: string };
type NavMenuEntry = { label: string; items: MenuItem[]; cards?: MenuItem[]; logos?: Mark[] };
type NavEntry = NavLink | NavMenuEntry;

const nav: NavEntry[] = [
  { label: "Product", items: product, cards: productCards },
  { label: "Docs", items: docs, logos: docsStack },
  { label: "Pricing", href: "/#pricing" },
  { label: "Company", items: company, cards: companyCards },
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
function NavMenu({ label, items, cards, logos }: NavMenuEntry) {
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
        className="flex items-center gap-1 text-base text-[color:var(--lp-muted)] transition-colors hover:text-[color:var(--lp-text)] aria-expanded:text-[color:var(--lp-text)]"
      >
        {label}
        <CaretDown size={12} weight="bold" className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open ? (
        <div className="absolute left-1/2 top-full z-50 -translate-x-1/2 pt-3">
          <div className="lp-menu-panel">
            <ul className="flex min-w-[150px] flex-col gap-3">
              {items.map((item) => (
                <li key={item.label}>
                  <MenuLink item={item} onPick={close} className="lp-menu-link">
                    {item.label}
                    {item.external ? <span className="ml-1 text-[0.85em]">↗</span> : null}
                  </MenuLink>
                </li>
              ))}
            </ul>
            {cards ? (
              <div className="flex w-[256px] flex-col gap-2">
                {cards.map((card) => (
                  <MenuLink key={card.label} item={card} onPick={close} className="lp-menu-card">
                    <span className="lp-menu-card-art">
                      <card.icon size={26} weight="duotone" aria-hidden />
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-[#f0f0f0]">{card.label}</span>
                      <span className="block text-[13px] text-[#a1a4a5]">{card.hint}</span>
                    </span>
                  </MenuLink>
                ))}
              </div>
            ) : null}
            {logos ? (
              <div>
                <ul className="grid grid-cols-4 gap-1">
                  {logos.map((icon) => (
                    <li key={icon.slug} className="lp-menu-logo" title={icon.title}>
                      <svg role="img" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-label={icon.title}>
                        <path d={icon.path} />
                      </svg>
                    </li>
                  ))}
                </ul>
              </div>
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

  const row = "flex w-full items-center justify-between rounded-xl px-3 py-3.5 text-md text-[var(--lp-text)] transition-colors active:bg-white/[0.06] hover:bg-white/[0.04]";

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
                  <div id={`mobile-${entry.label}`} className="lp-mobile-sub mb-3 mt-1 flex flex-col gap-4 px-3">
                    <ul className="flex flex-col gap-1">
                      {entry.items.map((item) => (
                        <li key={item.label}>
                          <MenuLink item={item} onPick={onClose} className="lp-menu-link block py-1.5">
                            {item.label}
                            {item.external ? <span className="ml-1 text-[0.85em]">↗</span> : null}
                          </MenuLink>
                        </li>
                      ))}
                    </ul>
                    {entry.cards ? (
                      <div className="flex flex-col gap-2">
                        {entry.cards.map((card) => (
                          <MenuLink key={card.label} item={card} onPick={onClose} className="lp-menu-card">
                            <span className="lp-menu-card-art">
                              <card.icon size={24} weight="duotone" aria-hidden />
                            </span>
                            <span>
                              <span className="block text-sm font-medium text-[#f0f0f0]">{card.label}</span>
                              <span className="block text-[13px] text-[#a1a4a5]">{card.hint}</span>
                            </span>
                          </MenuLink>
                        ))}
                      </div>
                    ) : null}
                    {entry.logos ? (
                      <div>
                        <ul className="grid grid-cols-4 gap-1">
                          {entry.logos.map((icon) => (
                            <li key={icon.slug} className="lp-menu-logo w-auto" title={icon.title}>
                              <svg role="img" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-label={icon.title}>
                                <path d={icon.path} />
                              </svg>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
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
          <span className="text-lg font-semibold tracking-tight">Qnetward</span>
        </Link>

        <ul className="hidden items-center gap-6 lg:flex">
          {nav.map((entry) => (
            <li key={entry.label}>
              {"items" in entry ? (
                <NavMenu label={entry.label} items={entry.items} cards={entry.cards} logos={entry.logos} />
              ) : (
                <a href={entry.href} className="text-base text-[color:var(--lp-muted)] transition-colors hover:text-[color:var(--lp-text)]">
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
            className="flex h-9 items-center gap-2 rounded-lg border border-[var(--lp-border)] px-3 text-base text-[color:var(--lp-muted)] transition-colors hover:text-[color:var(--lp-text)]"
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
