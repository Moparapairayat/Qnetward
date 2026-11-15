import Link from "next/link";
import { LandingNav } from "./landing-nav";
import { SiteFooter } from "./site-footer";

type Entry = { date: string; title: string; body: string; items: string[]; link?: { href: string; label: string } };

// Newest first. Each entry is what shipped that day, in the words a user would use.
const entries: Entry[] = [
  {
    date: "2026-11-15",
    title: "New developer docs",
    body: "The API docs are rebuilt around how people actually use them: a short path to the first request, then the details.",
    items: [
      "Documentation, Guides, and API Reference as three sections, with search on Ctrl K",
      "A five-minute Quickstart, and pages on authentication, errors, rate limits, webhooks, and live events",
      "Guides for monitoring an endpoint, checking deploys from CI, receiving webhooks, and building a live status board",
      "Every sample in curl, JavaScript, Python, and Go, remembered across pages",
    ],
    link: { href: "/docs", label: "Read the docs" },
  },
  {
    date: "2026-11-14",
    title: "Teams you can actually run",
    body: "Inviting, handing over, and securing a workspace no longer needs a support email.",
    items: [
      "Invitations arrive by email with a link to accept, and can be resent or copied",
      "Owners can transfer ownership, and members can leave, while a workspace always keeps an owner",
      "Owners can require two-factor sign-in for everyone, and see who has it turned on",
      "The viewer role is read-only across the whole API",
      "Qnetward is now open source under the AGPL-3.0",
    ],
  },
  {
    date: "2026-11-13",
    title: "Everything is live",
    body: "The console stops polling and updates the moment something changes.",
    items: [
      "Every check, alert, and change arrives as a live event, resumable after a dropped connection",
      "Probe agents keep a live link for instant sync, Run now, and Live mode",
      "Public status pages update on their own",
      "Plans and prices come straight from the API, so the site always shows what is charged",
    ],
  },
  {
    date: "2026-11-12",
    title: "Infrastructure and security",
    body: "One agent now reports hosts and network devices, and security scanning goes deeper, safely.",
    items: [
      "Host CPU, memory, disk, and network from agents, with alerts when they stay high",
      "Routers and switches polled over SNMP",
      "Attack surface scans for verified domains, on a schedule, with alerts on new exposure",
      "Found software matched to known vulnerabilities, and Tier 2 deep scans with signed consent",
      "A compliance view that maps scan evidence to CIS, PCI DSS, ISO 27001, and SOC 2",
      "An interactive API reference",
    ],
  },
  {
    date: "2026-11-11",
    title: "Passive checks and multi-location monitors",
    body: "See how a domain looks from outside, and whose network a failure is on.",
    items: [
      "Passive security checks that grade a domain from public signals, and watched domains that alert when the grade drops",
      "A monitor can run from several locations at once, and is down only when they all agree",
      "Agent ping and TCP samples flow into History and alert rules",
    ],
  },
  {
    date: "2026-11-07",
    title: "Status pages, traceroute, and probe agents",
    body: "Share uptime with your users, and reach networks the cloud can't.",
    items: ["Public status pages", "A traceroute tool", "Probe agents you enroll inside your own network", "Live updates in the console"],
  },
  {
    date: "2026-11-06",
    title: "Alert channels and Pro",
    body: "Alerts reach the tools your team already reads.",
    items: ["Alerts to Slack, Discord, Telegram, and signed webhooks", "Pro is on sale, paid with bKash, Nagad, or Rocket"],
  },
  {
    date: "2026-11-03",
    title: "Faster sign-in",
    body: "Fewer passwords to type.",
    items: ["Sign in with Google or a passkey", "API keys are created in a short stepped dialog"],
  },
  {
    date: "2026-11-02",
    title: "API keys, audit log, and two-factor",
    body: "The foundations for using Qnetward from code, and for trusting who did what.",
    items: [
      "Workspace API keys with read, write, and probe scopes, and an OpenAPI spec",
      "An append-only audit log",
      "Two-factor sign-in with an authenticator app",
      "Plans with per-workspace quotas and usage",
    ],
  },
  {
    date: "2026-11-01",
    title: "Uptime monitors",
    body: "Checks that keep running when nobody is watching.",
    items: [
      "Scheduled ICMP and TCP monitors",
      "HTTP(S) monitors with status checks and certificate expiry warnings",
      "Workspace data kept apart by row-level security in the database",
    ],
  },
];

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function ChangelogPage() {
  return (
    <>
      <LandingNav />
      <main id="main" className="lp-hero-type">
        <section className="lp-container max-w-5xl pb-12 pt-20">
          <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] text-[#e5e5e5] sm:text-[52px]">Changelog</h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-[var(--lp-muted)]">
            What&apos;s new in Qnetward, newest first. Follow along on{" "}
            <a href="https://github.com/Quantum-Axis/Qnetward" className="text-[var(--lp-text)] underline decoration-white/30 underline-offset-4 hover:decoration-[var(--lp-accent)]" target="_blank" rel="noreferrer">
              GitHub
            </a>
            .
          </p>
        </section>

        <section className="lp-container max-w-5xl pb-28">
          <ol>
            {entries.map((e) => (
              <li key={e.date} id={e.date} className="lp-reveal grid gap-4 border-t border-[var(--lp-border)] py-12 md:grid-cols-[200px_minmax(0,1fr)] md:gap-12">
                <div>
                  <time dateTime={e.date} className="text-sm text-[var(--lp-muted)] md:sticky md:top-24">
                    {fmt(e.date)}
                  </time>
                </div>
                <div>
                  <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-[#e5e5e5]">
                    <a href={`#${e.date}`} className="hover:text-white">
                      {e.title}
                    </a>
                  </h2>
                  <p className="mt-3 text-md leading-relaxed text-[var(--lp-muted)]">{e.body}</p>
                  <ul className="mt-5 space-y-2.5">
                    {e.items.map((item) => (
                      <li key={item} className="relative pl-5 text-md leading-relaxed text-[#c4c4cc]">
                        <span className="absolute left-0 top-[0.7em] h-1.5 w-1.5 rounded-full bg-[var(--lp-accent)]" aria-hidden />
                        {item}
                      </li>
                    ))}
                  </ul>
                  {e.link ? (
                    <Link href={e.link.href} className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--lp-text)] hover:text-[var(--lp-accent)]">
                      {e.link.label} <span aria-hidden>→</span>
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
