import Link from "next/link";
import { CodeTabs } from "./code-tabs";
import { Faq } from "./faq";
import { HeroConsole } from "./hero-console";
import { LandingEffects } from "./landing-effects";
import { LandingNav } from "./landing-nav";
import { SiteFooter } from "./site-footer";
import { NetworkCanvas } from "./network-canvas";
import { Pricing } from "./pricing";
import { ProductShowcase } from "./product-showcase";
import { MonitorStackVisual, MonitorVisual, ProbeVisual, WorkspaceVisual } from "./step-visuals";
import { TechLogos } from "./tech-logos";
import { ToolComparison } from "./tool-comparison";
import { WorldHexMap } from "./world-hex-map";

const steps = [
  {
    title: "Create a workspace",
    body: "Sign up with an email address. A workspace is created for you, and you can invite teammates now or later.",
    visual: <WorkspaceVisual />,
  },
  {
    title: "Point it at something",
    body: "Ping a host, scan its ports, or pull its DNS records. Results stream in as they happen and are kept in history.",
    visual: <ProbeVisual />,
  },
  {
    title: "Keep watching what matters",
    body: "Turn a URL, port, or host into a monitor checked every minute, even with the tab closed. When it goes down, or a certificate is about to expire, you get an email.",
    visual: <MonitorVisual />,
  },
];


const securityToday = [
  "Passwords hashed with bcrypt; sessions, reset tokens, and API keys stored only as hashes",
  "Two-factor sign-in with an authenticator app, and an append-only audit log",
  "Rate limits on sign-in, verification, and probe endpoints",
  "Strict origin checks on the API and live WebSocket",
  "Workspace data kept apart by row-level security in the database",
  "Probes to private and cloud-metadata addresses blocked by default",
];

const securityBeforeScans = [
  "Proof of ownership via DNS TXT record or HTTP token",
  "Per-target scope, rate limit, and a kill switch",
  "An audit log entry for every scan: who, what, when",
];

const scanTiers = [
  {
    tier: "Tier 0",
    name: "Passive",
    who: "Any domain",
    body: "Public signals only: certificates, DNS records, and HTTP headers. Nothing is sent that a browser wouldn't send.",
  },
  {
    tier: "Tier 1",
    name: "Active",
    who: "Verified owners",
    body: "Port and service discovery, unlocked only after you prove ownership with a DNS TXT record or an HTTP token.",
  },
  {
    tier: "Tier 2",
    name: "Deep",
    who: "By approval",
    body: "Authenticated or intrusive checks. Needs a paid plan, signed consent, and a manual review before the first run.",
  },
];

function SectionHeader({
  label,
  title,
  aside,
}: {
  label?: string;
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="lp-reveal grid gap-6 lg:grid-cols-12 lg:items-end">
      <div className={aside ? "lg:col-span-7" : "lg:col-span-12"}>
        {label ? <div className="mb-4 text-sm text-[var(--lp-accent)]">{label}</div> : null}
        <h2 className="text-2xl font-normal leading-[1.12] tracking-[-0.025em] sm:text-4xl">{title}</h2>
      </div>
      {aside ? <div className="text-md leading-relaxed text-[var(--lp-muted)] lg:col-span-5 lg:pb-1.5">{aside}</div> : null}
    </div>
  );
}

// Tier markers brighten as the access they grant grows.
const tierTone = [
  { border: "rgba(74,222,128,0.45)", text: "#86efac" },
  { border: "rgba(251,191,36,0.45)", text: "#fcd34d" },
  { border: "rgba(255,61,127,0.5)", text: "#ff8fb3" },
];

function Check({ muted = false }: { muted?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="mt-[3px] shrink-0">
      {muted ? (
        <circle cx="8" cy="8" r="5.5" stroke="var(--lp-subtle)" strokeDasharray="2 2" />
      ) : (
        <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="var(--lp-green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

export function LandingPage() {
  return (
    <>
      <LandingEffects />
      {/* announcement */}
      <div className="border-b border-[var(--lp-border)] bg-[var(--lp-bg-raised)]">
        <div className="lp-container flex h-10 items-center justify-center gap-3 text-sm">
          <span className="lp-badge lp-badge-new">New</span>
          <span className="text-[var(--lp-muted)]">
            <span className="hidden sm:inline">Uptime monitors for websites, APIs, and servers are live</span>
            <span className="sm:hidden">Uptime monitors are live</span>
          </span>
          <Link href="/signup" className="text-[var(--lp-text)] underline-offset-4 hover:underline">
            Try it →
          </Link>
        </div>
      </div>

      <LandingNav />

      <main id="main">
        {/* hero */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="lp-aurora lp-aurora-a" />
            <div className="lp-aurora lp-aurora-b" />
          </div>
          <NetworkCanvas className="absolute inset-x-0 top-0 h-[760px] w-full opacity-40 [mask-image:linear-gradient(to_bottom,black_55%,transparent)] sm:opacity-80" />
          <div className="lp-container relative pb-16 pt-10 text-center sm:pt-20">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-[var(--lp-border)] bg-white/[0.03] px-3 py-1 text-xs text-[var(--lp-muted)]">
              <span className="lp-pulse h-1.5 w-1.5 rounded-full bg-[var(--lp-green)]" />
              Network · Infrastructure · Security
            </div>
            <h1 className="mx-auto mt-5 max-w-4xl text-3xl font-normal leading-[1.08] tracking-[-0.035em] sm:text-5xl">
              <span className="lp-hero-text">See every network, server, and threat</span>
              <span className="lp-cursor" />
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-md leading-relaxed text-[var(--lp-muted)] sm:text-lg">
              Qnetward probes, monitors, and protects your infrastructure from one platform.{" "}
              <br className="hidden md:block" />
              Diagnostics and uptime monitors today. Agents and attack-surface scans next.
            </p>
            {/* Phones keep both buttons on one row, with shorter labels. */}
            <div className="mx-auto mt-7 grid max-w-sm grid-cols-2 gap-2.5 sm:flex sm:max-w-none sm:items-center sm:justify-center sm:gap-3">
              <Link href="/signup" className="lp-btn lp-btn-primary h-11 px-3 text-base sm:px-6 sm:text-md">
                <span className="sm:hidden">Start free</span>
                <span className="hidden sm:inline">Start monitoring free</span>
              </Link>
              <a href="#how" className="lp-btn lp-btn-secondary h-11 px-3 text-base sm:px-6 sm:text-md">
                <span className="sm:hidden">How it works</span>
                <span className="hidden sm:inline">See how it works</span>
              </a>
            </div>
            {/* One row on every width: tighter spacing and type on phones. */}
            <ul className="mt-5 flex flex-nowrap items-center justify-center gap-x-3 whitespace-nowrap text-xs text-[var(--lp-subtle)] sm:gap-x-6 sm:text-sm">
              {["Free to start", "No credit card", "Self-host ready"].map((item) => (
                <li key={item} className="flex items-center gap-1.5 sm:gap-2">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5">
                    <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="var(--lp-green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
            <div className="lp-reveal mt-10 sm:mt-12">
              <HeroConsole />
            </div>
          </div>
        </section>

        {/* stack strip */}
        <section className="lp-divider py-14">
          <div className="lp-container lp-reveal">
            <TechLogos />
          </div>
        </section>

        {/* comparison */}
        <section className="lp-divider py-20 sm:py-28">
          <div className="lp-container">
            <SectionHeader
              label="Why one tool"
              title="Five tabs during an outage is four too many"
              aside="Most teams stitch diagnostics together from terminal commands, a website or two, and a separate uptime service. Qnetward puts them behind one login, with shared history."
            />
            <div className="mt-14">
              <ToolComparison />
            </div>
          </div>
        </section>

        {/* how it works */}
        <section id="how" className="lp-divider scroll-mt-20 py-20 sm:py-28">
          <div className="lp-container grid grid-cols-1 gap-14 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <div className="lg:sticky lg:top-28">
                <SectionHeader label="How it works" title="Three steps, no install" />
                <p className="lp-reveal mt-6 max-w-sm text-md leading-relaxed text-[var(--lp-muted)]">
                  The console runs every probe from our side, so you can start before you&apos;ve decided where an
                  agent should live.
                </p>
                <Link href="/signup" className="lp-reveal mt-8 inline-flex items-center gap-2 text-base text-[var(--lp-text)] hover:text-[var(--lp-accent)]">
                  Create a workspace <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
            <ol className="lg:col-span-7">
              {steps.map((step, i) => (
                <li key={step.title} className="lp-reveal relative grid grid-cols-[40px_1fr] gap-x-4 pb-12 last:pb-0 sm:grid-cols-[48px_1fr]">
                  {/* The rail joins the step numbers; it stops at the last one. */}
                  {i < steps.length - 1 ? (
                    <span aria-hidden="true" className="absolute bottom-0 left-[15px] top-9 w-px bg-gradient-to-b from-[var(--lp-border-strong)] to-transparent" />
                  ) : null}
                  <span className="lp-mono relative grid h-8 w-8 place-items-center rounded-full border border-[var(--lp-border-strong)] bg-[var(--lp-bg-raised)] text-xs text-[var(--lp-muted)]">
                    {i + 1}
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <h3 className="text-xl font-normal tracking-[-0.01em]">{step.title}</h3>
                    <p className="mt-3 max-w-lg text-md leading-relaxed text-[var(--lp-muted)]">{step.body}</p>
                    <div className="mt-6">{step.visual}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* products */}
        <section id="products" className="lp-divider scroll-mt-20 py-20 sm:py-28">
          <div className="lp-container">
            <SectionHeader
              label="Product"
              title="The tools you open during an incident, in one tab"
              aside="Every screen here is the console as it ships today, captured from the demo workspace."
            />
            <div className="lp-reveal mt-14">
              <ProductShowcase />
            </div>
          </div>
        </section>

        {/* developers */}
        <section id="developers" className="lp-divider scroll-mt-20 py-20 sm:py-28">
          <div className="lp-container grid grid-cols-1 gap-14 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <SectionHeader label="Developers" title="The console is a client like any other" />
              <p className="lp-reveal mt-6 text-md leading-relaxed text-[var(--lp-muted)]">
                The same Go engine sits behind the CLI, the REST API, and the WebSocket stream the dashboard uses. If the
                console can do it, so can your script.
              </p>
              <dl className="lp-reveal mt-10 border-t border-[var(--lp-border)] text-base">
                {[
                  ["Binary", "One static executable for Linux, macOS, and Windows"],
                  ["Output", "--json on every command, ready for jq or a pipeline"],
                  ["Control", "Start, stream, and cancel a run over one socket"],
                ].map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[96px_1fr] gap-4 border-b border-[var(--lp-border)] py-4">
                    <dt className="text-[var(--lp-subtle)]">{k}</dt>
                    <dd className="text-[var(--lp-muted)]">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="lp-reveal mt-8 flex flex-wrap gap-3">
                <Link href="/docs/api" className="lp-btn lp-btn-primary h-10">
                  Read the API reference
                </Link>
                <a href="/openapi.yaml" download className="lp-btn lp-btn-secondary h-10">
                  Download OpenAPI
                </a>
              </div>
            </div>
            <div className="lp-reveal flex lg:col-span-7">
              <CodeTabs />
            </div>
          </div>
        </section>

        {/* security */}
        <section id="security" className="lp-divider scroll-mt-20 py-20 sm:py-28">
          <div className="lp-container grid grid-cols-1 gap-14 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <SectionHeader label="Security" title="A scanner should refuse to scan what isn't yours" />
              <p className="lp-reveal mt-6 text-md leading-relaxed text-[var(--lp-muted)]">
                Deeper security scanning is on the way. The guardrails on the right ship first, and no active scan runs
                against a target until every one of them is in place.
              </p>
            </div>
            <div className="lp-reveal grid gap-px overflow-hidden rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-border)] sm:grid-cols-2 lg:col-span-7">
              <div className="bg-[var(--lp-bg)] p-8">
                <h3 className="text-sm text-[var(--lp-muted)]">In place today</h3>
                <ul className="mt-6 space-y-4">
                  {securityToday.map((item) => (
                    <li key={item} className="flex gap-3 text-base leading-relaxed text-[var(--lp-text)]">
                      <Check />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-[var(--lp-bg)] p-8">
                <h3 className="text-sm text-[var(--lp-muted)]">Required before any active scan</h3>
                <ul className="mt-6 space-y-4">
                  {securityBeforeScans.map((item) => (
                    <li key={item} className="flex gap-3 text-base leading-relaxed text-[var(--lp-muted)]">
                      <Check muted />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="lp-reveal lg:col-span-12">
              <div className="flex items-baseline justify-between gap-6 border-b border-[var(--lp-border)] pb-4">
                <h3 className="text-md font-medium">How scanning will be gated</h3>
                <span className="text-sm text-[var(--lp-subtle)]">Planned · each tier unlocks the next</span>
              </div>
              <ol className="relative mt-8 grid gap-8 md:grid-cols-3 md:gap-6">
                {/* One line runs through the tier markers: across on wide screens, down on phones. */}
                <span aria-hidden="true" className="absolute left-[15px] top-4 bottom-4 w-px bg-[var(--lp-border-strong)] md:left-4 md:right-4 md:top-[15px] md:bottom-auto md:h-px md:w-auto" />
                {scanTiers.map((t, i) => (
                  <li key={t.tier} className="relative grid grid-cols-[32px_1fr] gap-x-4 md:block">
                    <span
                      className="lp-mono relative z-10 grid h-8 w-8 place-items-center rounded-full border text-xs"
                      style={{
                        borderColor: tierTone[i].border,
                        color: tierTone[i].text,
                        background: "var(--lp-bg)",
                        boxShadow: `0 0 0 4px var(--lp-bg)`,
                      }}
                    >
                      {i}
                    </span>
                    <div className="md:mt-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-lg font-normal">{t.name}</h4>
                        <span className="rounded-md border border-[var(--lp-border)] px-1.5 py-px text-xs text-[var(--lp-muted)]">{t.who}</span>
                      </div>
                      <p className="mt-2 max-w-sm text-base leading-relaxed text-[var(--lp-muted)]">{t.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* network */}
        <section id="network" className="lp-divider relative scroll-mt-20 overflow-hidden pt-28">
          <div className="lp-container relative z-10">
            <SectionHeader
              label="Network"
              title="One vantage point can't tell you whose problem it is"
              aside={
                <>
                  Probing from several regions separates a local blip from a regional outage. We start in Singapore and
                  add regions where customers need them.
                  <span className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--lp-subtle)]">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[var(--lp-accent)]" /> Primary
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-white" /> Planned
                    </span>
                    <span>Regions shown are planned locations</span>
                  </span>
                </>
              }
            />
          </div>
          {/* Glow sits on the full-width section so it can never be clipped by the map container. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(ellipse 28% 32% at 70% 58%, rgba(255,61,127,0.09), transparent 100%)" }}
          />
          <div className="relative mx-auto mt-10 max-w-[1400px] px-2 pb-20 sm:px-6">
            <div className="lp-reveal">
              <WorldHexMap />
            </div>
          </div>
        </section>

        {/* pricing */}
        <section id="pricing" className="lp-divider scroll-mt-20 py-20 sm:py-28">
          <div className="lp-container">
            <SectionHeader
              label="Pricing"
              title="Start free, grow into Pro"
              aside="Everything that exists today is free, with room for a small team. Pro raises the limits when you need more, paid in taka with bKash, Nagad, Rocket, or card."
            />
            <div className="mt-14">
              <Pricing />
            </div>
          </div>
        </section>

        {/* faq */}
        <section id="faq" className="lp-divider scroll-mt-20 py-20 sm:py-28">
          <div className="lp-container grid grid-cols-1 gap-14 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <SectionHeader label="FAQ" title="Common questions" />
              <p className="lp-reveal mt-6 text-md leading-relaxed text-[var(--lp-muted)]">
                Not covered here? The console is free to explore, so the quickest answer is often to try it.
              </p>
            </div>
            <div className="lp-reveal lg:col-span-8">
              <Faq />
            </div>
          </div>
        </section>

        {/* closing CTA */}
        <section className="lp-divider py-20 sm:py-28">
          <div className="lp-container">
            <div className="lp-reveal lp-cta-panel relative overflow-hidden rounded-3xl border border-[var(--lp-border-strong)] px-6 py-12 sm:px-12 sm:py-16">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{ background: "radial-gradient(ellipse 45% 80% at 0% 100%, rgba(255,61,127,0.16), transparent 70%)" }}
              />
              <div className="relative grid grid-cols-1 items-center gap-12 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <h2 className="text-3xl font-normal leading-[1.08] tracking-[-0.03em] sm:text-4xl">
                    <span className="lp-hero-text">Start watching your network</span>
                    <span className="lp-cursor" />
                  </h2>
                  <p className="mt-5 max-w-md text-md leading-relaxed text-[var(--lp-muted)]">
                    Free to start, no card required. Your first probe runs in under a minute, and your monitors keep
                    checking after you close the tab.
                  </p>
                  <div className="mt-8 flex gap-3">
                    <Link href="/signup" className="lp-btn lp-btn-primary h-11 flex-[1.6] whitespace-nowrap px-4 text-md sm:flex-none sm:px-6">
                      Create free account
                    </Link>
                    <Link href="/login" className="lp-btn lp-btn-secondary h-11 flex-1 whitespace-nowrap px-4 text-md sm:flex-none sm:px-6">
                      Sign in
                    </Link>
                  </div>
                </div>
                <div className="lg:col-span-5">
                  <MonitorStackVisual />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
