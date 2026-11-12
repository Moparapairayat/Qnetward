import Link from "next/link";
import { QnetwardMark } from "./qnetward-mark";
import { SocialLinks } from "./social-links";

// Links start with "/" so the footer works on every marketing page, not only the home page.
const columns: { title: string; links: [string, string][] }[] = [
  {
    title: "Product",
    links: [
      ["Ping & TCP ping", "/#products"],
      ["Port scan", "/#products"],
      ["DNS lookup", "/#products"],
      ["Alert rules", "/#products"],
      ["Pricing", "/#pricing"],
    ],
  },
  {
    title: "Platform",
    links: [
      ["Roadmap", "/roadmap"],
      ["Probe agents", "/roadmap#theme-reach"],
      ["Attack surface", "/roadmap#theme-secure"],
      ["Global network", "/#network"],
    ],
  },
  {
    title: "Developers",
    links: [
      ["CLI", "/#developers"],
      ["API reference", "/docs/api"],
      ["OpenAPI spec", "/openapi.yaml"],
      ["Live WebSocket", "/#developers"],
      ["GitHub", "https://github.com/Quantum-Axis/Qnetward"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About", "/about"],
      ["Team", "/team"],
      ["Contact", "/about#contact"],
      ["Security", "/#security"],
      ["FAQ", "/#faq"],
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="lp-divider pb-10 pt-16">
      <div className="lp-container">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2.5">
              <QnetwardMark size={24} />
              <span className="font-semibold">Qnetward</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-[var(--lp-muted)]">Unified network, infrastructure, and security observability.</p>
            <SocialLinks className="mt-6" />
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <h3 className="text-sm font-medium">{col.title}</h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map(([label, href]) => (
                  <li key={label} className="text-sm text-[var(--lp-muted)]">
                    <a href={href} {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})} className="transition-colors hover:text-[var(--lp-text)]">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-[var(--lp-border)] pt-6 text-[13px] text-[var(--lp-subtle)] sm:flex-row sm:items-center">
          <span>© 2026 Qnetward. All rights reserved.</span>
          <div className="flex gap-5">
            <Link href="/terms" className="hover:text-[var(--lp-text)]">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-[var(--lp-text)]">
              Privacy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
