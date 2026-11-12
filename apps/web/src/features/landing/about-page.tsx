/* eslint-disable @next/next/no-img-element -- GitHub avatars, small and already sized */
import Link from "next/link";
import { LandingNav } from "./landing-nav";
import { SiteFooter } from "./site-footer";
import { socialLinks } from "./social-links";
import { team } from "./team-data";

const principles = [
  {
    title: "Safe by default",
    body: "Deeper scans only run against domains you've proven you control, and the deepest ones need your signed consent and our approval. A scanner should refuse to scan what isn't yours.",
  },
  {
    title: "Outbound only",
    body: "Agents inside your network dial out to Qnetward over HTTPS. You never open a port to us, and device credentials are sealed and sent only to the agent that uses them.",
  },
  {
    title: "Open and inspectable",
    body: "Qnetward is built in the open on GitHub. Every console action has a documented API, so anything you can click, you can script.",
  },
  {
    title: "Honest about limits",
    body: "Compliance results are evidence, not a certificate. We say what a check can't see, and we'd rather show “not assessed” than a green tick we haven't earned.",
  },
];

const facts = [
  ["1 agent", "for checks, host metrics, and network devices"],
  ["3 tiers", "of security scanning, gated by proof and consent"],
  ["4 frameworks", "mapped in compliance: CIS, PCI DSS, ISO 27001, SOC 2"],
  ["0 inbound ports", "to open in your network"],
];

export function AboutPage() {
  const email = socialLinks.find((s) => s.icon === "email")?.href.replace("mailto:", "") ?? "";
  return (
    <>
      <LandingNav />
      <main id="main">
        <section className="lp-container max-w-5xl pb-16 pt-20">
          <p className="text-[13px] text-[var(--lp-accent)]">About</p>
          <h1 className="mt-4 max-w-3xl text-[40px] font-normal leading-[1.1] tracking-[-0.025em] sm:text-[52px]">
            One place to watch your network, servers, and security
          </h1>
          <p className="mt-6 max-w-2xl text-[17px] leading-relaxed text-[var(--lp-muted)]">
            Most teams stitch together a ping tool, an uptime checker, a metrics agent, an SNMP poller, and a security scanner, then lose the
            context between them. Qnetward puts all of it behind one console, one agent, and one API.
          </p>
        </section>

        <section className="lp-divider py-16">
          <div className="lp-container grid max-w-5xl gap-12 lg:grid-cols-[260px_minmax(0,1fr)]">
            <h2 className="text-[22px] font-normal tracking-[-0.01em]">Why we build it</h2>
            <div className="space-y-5 text-[16px] leading-relaxed text-[var(--lp-muted)]">
              <p>
                When something breaks, the first questions are always the same: is it the network, the server, or something we changed? Answering
                them shouldn&apos;t mean opening five tools. Qnetward measures reachability, latency, host load, device interfaces, and exposure
                side by side, so the answer is usually on one screen.
              </p>
              <p>
                Security scanning lives in the same place because exposure is an operational problem too. A forgotten database port or an expiring
                certificate deserves the same alert as a server that went down.
              </p>
            </div>
          </div>
        </section>

        <section className="lp-divider py-16">
          <div className="lp-container max-w-5xl">
            <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-[var(--lp-border)] lg:grid-cols-4">
              {facts.map(([value, label], i) => (
                <div key={value} className={`px-6 py-6 ${i % 2 ? "border-l" : ""} ${i > 1 ? "border-t lg:border-t-0" : ""} ${i === 2 ? "lg:border-l" : ""} border-[var(--lp-border)]`}>
                  <dt className="text-[26px] tracking-[-0.02em]">{value}</dt>
                  <dd className="mt-1.5 text-[14px] leading-snug text-[var(--lp-muted)]">{label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="lp-divider py-16">
          <div className="lp-container max-w-5xl">
            <h2 className="text-[22px] font-normal tracking-[-0.01em]">What we believe</h2>
            <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-border)] sm:grid-cols-2">
              {principles.map((p) => (
                <div key={p.title} className="bg-[var(--lp-bg)] p-7">
                  <h3 className="text-[16px]">{p.title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--lp-muted)]">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-divider py-16">
          <div className="lp-container flex max-w-5xl flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[22px] font-normal tracking-[-0.01em]">Built in the open</h2>
              <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-[var(--lp-muted)]">
                {team.length} people have shaped Qnetward so far, from the probe engine to the console.
              </p>
              <div className="mt-6 flex -space-x-2.5">
                {team.slice(0, 8).map((m) => (
                  <img
                    key={m.github}
                    src={`${m.avatar.split("?")[0]}?s=80&v=4`}
                    alt={m.name}
                    title={m.name}
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-full border-2 border-[var(--lp-bg)] bg-[var(--lp-bg-raised)]"
                  />
                ))}
                {team.length > 8 ? (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[var(--lp-bg)] bg-[var(--lp-bg-raised)] text-[12px] text-[var(--lp-muted)]">
                    +{team.length - 8}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 gap-3">
              <Link href="/team" className="lp-btn lp-btn-primary">
                Meet the team
              </Link>
              <a href="https://github.com/Quantum-Axis/Qnetward" target="_blank" rel="noreferrer" className="lp-btn lp-btn-secondary">
                View on GitHub
              </a>
            </div>
          </div>
        </section>

        <section id="contact" className="lp-divider scroll-mt-20 py-16">
          <div className="lp-container max-w-5xl">
            <h2 className="text-[22px] font-normal tracking-[-0.01em]">Contact</h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                { title: "Sales and questions", body: "Plans, pilots, and anything else.", cta: email, href: `mailto:${email}` },
                { title: "Bugs and ideas", body: "Open an issue and we'll pick it up.", cta: "GitHub issues", href: "https://github.com/Quantum-Axis/Qnetward/issues" },
                { title: "Security reports", body: "Found a vulnerability? Tell us privately first.", cta: email, href: `mailto:${email}?subject=Security%20report` },
              ].map((c) => (
                <div key={c.title} className="rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-bg-raised)] p-6">
                  <h3 className="text-[15px]">{c.title}</h3>
                  <p className="mt-1.5 text-[14px] text-[var(--lp-muted)]">{c.body}</p>
                  <a
                    href={c.href}
                    {...(c.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                    className="mt-4 inline-block text-[14px] text-[var(--lp-accent)] hover:underline"
                  >
                    {c.cta} →
                  </a>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
