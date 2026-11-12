import Link from "next/link";
import { LandingNav } from "./landing-nav";
import { SiteFooter } from "./site-footer";
import { horizonMeta, roadmap, type Horizon } from "./roadmap-data";

const pill: Record<Horizon, string> = {
  now: "border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.08)] text-[#86efac]",
  next: "border-[rgba(255,61,127,0.35)] bg-[rgba(255,61,127,0.08)] text-[#ff8fb3]",
  later: "border-[var(--lp-border)] bg-white/[0.03] text-[var(--lp-subtle)]",
};

export function RoadmapPage() {
  const counts = (["now", "next", "later"] as Horizon[]).map((h) => ({
    horizon: h,
    count: roadmap.reduce((sum, theme) => sum + theme.items.filter((i) => i.horizon === h).length, 0),
  }));

  return (
    <>
      <LandingNav />
      <main id="main" className="lp-container max-w-5xl py-20">
        <p className="text-[13px] text-[var(--lp-accent)]">Roadmap</p>
        <h1 className="mt-4 max-w-3xl text-[40px] font-normal leading-[1.1] tracking-[-0.025em] sm:text-[48px]">Where Qnetward is going</h1>
        <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-[var(--lp-muted)]">
          What works today, what we&apos;re building next, and what comes after. There are no dates here on purpose: we&apos;d rather ship
          something and move it to Now than promise a quarter and miss it.
        </p>

        <dl className="mt-10 grid grid-cols-3 overflow-hidden rounded-xl border border-[var(--lp-border)] sm:max-w-xl">
          {counts.map(({ horizon, count }, i) => (
            <div key={horizon} className={`px-5 py-4 ${i > 0 ? "border-l border-[var(--lp-border)]" : ""}`}>
              <dt className="text-[13px] text-[var(--lp-muted)]">{horizonMeta[horizon].label}</dt>
              <dd className="mt-1 text-[24px] tracking-[-0.02em]">{count}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-16 space-y-14">
          {roadmap.map((theme) => (
            <section key={theme.id} aria-labelledby={`theme-${theme.id}`} className="grid gap-6 border-t border-[var(--lp-border)] pt-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-12">
              <div>
                <h2 id={`theme-${theme.id}`} className="text-[20px] font-normal tracking-[-0.01em]">
                  {theme.name}
                </h2>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--lp-muted)]">{theme.summary}</p>
              </div>
              <ul className="divide-y divide-[var(--lp-border)] rounded-xl border border-[var(--lp-border)] bg-[var(--lp-bg-raised)]">
                {theme.items.map((item) => (
                  <li key={item.name} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                    <div className="min-w-0">
                      <h3 className={`text-[15px] ${item.horizon === "now" ? "text-[var(--lp-text)]" : "text-[var(--lp-text)]/90"}`}>{item.name}</h3>
                      <p className="mt-1 text-[14px] leading-relaxed text-[var(--lp-muted)]">{item.body}</p>
                    </div>
                    <span className={`w-fit shrink-0 rounded-full border px-2.5 py-0.5 text-[12px] ${pill[item.horizon]}`}>{horizonMeta[item.horizon].label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-20 rounded-2xl border border-[var(--lp-border)] bg-[var(--lp-bg-raised)] p-8 sm:flex sm:items-center sm:justify-between sm:gap-8">
          <div>
            <h2 className="text-[18px] font-normal">Everything under Now is free during the beta</h2>
            <p className="mt-1.5 text-[14px] text-[var(--lp-muted)]">Start with the tools that exist today. New ones show up in the same console.</p>
          </div>
          <div className="mt-5 flex shrink-0 gap-3 sm:mt-0">
            <Link href="/signup" className="lp-btn lp-btn-primary">
              Start free
            </Link>
            <Link href="/" className="lp-btn lp-btn-secondary">
              Back to home
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
