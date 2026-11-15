/**
 * The docs are three sections, like tabs across the top: Documentation (how
 * the API works), Guides (doing one job end to end), and the API reference.
 * Each has its own sidebar; prev/next links follow the sidebar's order.
 */

export type DocLink = { href: string; label: string };
export type DocGroup = { title: string; items: DocLink[] };
export type SectionId = "docs" | "guides" | "reference";
export type Section = { id: SectionId; label: string; href: string; groups: DocGroup[] };

const documentation: DocGroup[] = [
  {
    title: "Get started",
    items: [
      { href: "/docs", label: "Introduction" },
      { href: "/docs/quickstart", label: "Quickstart" },
    ],
  },
  {
    title: "Essentials",
    items: [
      { href: "/docs/authentication", label: "Authentication" },
      { href: "/docs/errors", label: "Errors" },
      { href: "/docs/rate-limits", label: "Rate limits" },
    ],
  },
  {
    title: "Events",
    items: [
      { href: "/docs/webhooks", label: "Webhooks" },
      { href: "/docs/live-events", label: "Live events" },
    ],
  },
];

const guides: DocGroup[] = [
  {
    title: "Guides",
    items: [{ href: "/docs/guides", label: "Overview" }],
  },
  {
    title: "Monitoring",
    items: [
      { href: "/docs/guides/monitor-an-endpoint", label: "Monitor an API endpoint" },
      { href: "/docs/guides/probes-in-ci", label: "Check a deploy from CI" },
    ],
  },
  {
    title: "Events",
    items: [
      { href: "/docs/guides/receive-webhooks", label: "Receive webhooks in your app" },
      { href: "/docs/guides/live-dashboard", label: "Build a live status board" },
    ],
  },
];

// Scalar puts each tag at #tag/<name in kebab case>.
const tag = (label: string) => ({ href: `/docs/api#tag/${label.toLowerCase().replace(/\s+/g, "-")}`, label });

const reference: DocGroup[] = [
  {
    title: "API reference",
    items: [
      tag("Diagnostics"),
      tag("Monitors"),
      tag("Alert rules"),
      tag("History"),
      tag("Status pages"),
      tag("Hosts"),
      tag("Network devices"),
      tag("Attack surface"),
      tag("Vulnerabilities"),
      tag("Live events"),
    ],
  },
];

export const sections: Section[] = [
  { id: "docs", label: "Documentation", href: "/docs", groups: documentation },
  { id: "guides", label: "Guides", href: "/docs/guides", groups: guides },
  { id: "reference", label: "API Reference", href: "/docs/api", groups: reference },
];

export function sectionFor(pathname: string): Section {
  if (pathname.startsWith("/docs/api")) return sections[2];
  if (pathname.startsWith("/docs/guides")) return sections[1];
  return sections[0];
}

/** Every page, for search. */
export const allPages: (DocLink & { section: string })[] = sections.flatMap((s) =>
  s.groups.flatMap((g) => g.items.map((i) => ({ ...i, section: s.label }))),
);

/** The hosted console; self-hosted users swap in their own address. */
export const BASE_URL = "https://console.qnetward.com";
