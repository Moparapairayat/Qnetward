/* eslint-disable @next/next/no-img-element -- GitHub avatars, small and already sized */
import Link from "next/link";
import { GitHubIcon, LandingNav } from "./landing-nav";
import { SiteFooter } from "./site-footer";
import { team } from "./team-data";

export function TeamPage() {
  return (
    <>
      <LandingNav />
      <main id="main" className="lp-container max-w-5xl py-20">
        <p className="text-sm text-[var(--lp-accent)]">Team</p>
        <h1 className="mt-4 max-w-3xl text-3xl font-normal leading-[1.1] tracking-[-0.025em] sm:text-4xl">The people behind Qnetward</h1>
        <p className="mt-5 max-w-2xl text-md leading-relaxed text-[var(--lp-muted)]">
          Qnetward is built in the open by the Quantum Axis organization and contributors on GitHub. Everyone here has shipped code, design, or
          ideas into the product you use.
        </p>

        <ul className="mt-14 grid grid-cols-1 gap-5 min-[480px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {team.map((m) => (
            <li key={m.github}>
              <a
                href={`https://github.com/${m.github}`}
                target="_blank"
                rel="noreferrer"
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-bg-raised)] transition-colors hover:border-white/20"
              >
                <span className="relative block aspect-square overflow-hidden bg-[var(--lp-bg)]">
                  <img
                    src={`${m.avatar.split("?")[0]}?s=460&v=4`}
                    alt={m.name}
                    width={460}
                    height={460}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                </span>
                <span className="flex flex-1 flex-col p-5">
                  <span className="text-lg leading-snug text-[var(--lp-text)]">{m.name}</span>
                  <span className="mt-1 text-base text-[var(--lp-muted)]">{m.role}</span>
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm text-[var(--lp-subtle)] transition-colors group-hover:text-[var(--lp-text)]">
                    <GitHubIcon size={14} /> @{m.github}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>

        <div className="mt-16 rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-bg-raised)] p-8 sm:flex sm:items-center sm:justify-between sm:gap-8">
          <div>
            <h2 className="text-lg font-normal">Want to help build it?</h2>
            <p className="mt-1.5 text-base text-[var(--lp-muted)]">Pick an issue, open a pull request, or tell us what you need. Contributors join this page.</p>
          </div>
          <div className="mt-5 flex shrink-0 gap-3 sm:mt-0">
            <a href="https://github.com/Quantum-Axis/Qnetward" target="_blank" rel="noreferrer" className="lp-btn lp-btn-primary">
              Contribute on GitHub
            </a>
            <Link href="/about" className="lp-btn lp-btn-secondary">
              About Qnetward
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
