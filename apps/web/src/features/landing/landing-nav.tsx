"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { QnetwardMark } from "./qnetward-mark";

const links = [
  { href: "/#products", label: "Product" },
  { href: "/#developers", label: "Developers" },
  { href: "/#security", label: "Security" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/docs/api", label: "Docs" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/#faq", label: "FAQ" },
];

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
          {links.map((link) => (
            <li key={link.href}>
              <a href={link.href} className="text-sm text-[color:var(--lp-muted)] transition-colors hover:text-[color:var(--lp-text)]">
                {link.label}
              </a>
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
            {links.map((link) => (
              <li key={link.href}>
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
