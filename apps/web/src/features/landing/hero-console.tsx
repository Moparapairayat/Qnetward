import Image from "next/image";
import dashboard from "../../../public/landing/dashboard.png";

/** The hero shows the real console: a screenshot of the Overview page inside a browser frame. */
export function HeroConsole() {
  return (
    <div className="relative mx-auto max-w-[1100px]">
      <div
        className="pointer-events-none absolute -inset-x-10 -top-10 bottom-0 rounded-[40px] opacity-70 blur-3xl"
        style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(255,61,127,0.25), transparent 65%)" }}
        aria-hidden="true"
      />

      <div className="relative overflow-hidden rounded-2xl border border-[var(--lp-border-strong)] bg-[#17171b] shadow-[0_40px_120px_rgba(0,0,0,0.55)]">
        {/* window chrome */}
        <div className="flex h-9 items-center gap-2 border-b border-[var(--lp-border)] px-4 sm:h-10" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="lp-mono ml-4 truncate text-[11px] text-[var(--lp-subtle)]">console.qnetward.io/overview</span>
        </div>

        <Image
          src={dashboard}
          alt="The Qnetward Overview: target count, average latency, packet loss, and alert rules, a response time chart per target, target health, and the targets table."
          sizes="(max-width: 1140px) 100vw, 1100px"
          placeholder="blur"
          priority
          className="block h-auto w-full"
        />
      </div>
    </div>
  );
}
