import Link from "next/link";
import { LandingNav } from "./landing-nav";

export type LegalSection = { heading: string; body: string[] };

export function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro: string; sections: LegalSection[] }) {
  return (
    <>
      <LandingNav />
      <main id="main" className="lp-container max-w-3xl py-20">
        <p className="text-sm text-[var(--lp-accent)]">Legal</p>
        <h1 className="mt-4 text-3xl font-normal tracking-[-0.025em]">{title}</h1>
        <p className="mt-3 text-base text-[var(--lp-subtle)]">Last updated {updated}</p>

        <div className="mt-8 rounded-xl border border-[rgba(251,191,36,0.35)] bg-[rgba(251,191,36,0.06)] px-5 py-4 text-base leading-relaxed text-[var(--lp-amber)]">
          Draft. This document has not yet been reviewed by a lawyer and may change before Qnetward leaves beta.
        </div>

        <p className="mt-10 text-md leading-relaxed text-[var(--lp-muted)]">{intro}</p>

        <div className="mt-12 space-y-12">
          {sections.map((section, i) => (
            <section key={section.heading}>
              <h2 className="text-xl font-normal">
                <span className="lp-mono mr-3 text-sm text-[var(--lp-subtle)]">{String(i + 1).padStart(2, "0")}</span>
                {section.heading}
              </h2>
              <div className="mt-4 space-y-4 text-md leading-relaxed text-[var(--lp-muted)]">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-16 flex gap-6 border-t border-[var(--lp-border)] pt-6 text-base text-[var(--lp-muted)]">
          <Link href="/" className="hover:text-[var(--lp-text)]">
            ← Back to home
          </Link>
          <Link href="/terms" className="hover:text-[var(--lp-text)]">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-[var(--lp-text)]">
            Privacy
          </Link>
        </div>
      </main>
    </>
  );
}
