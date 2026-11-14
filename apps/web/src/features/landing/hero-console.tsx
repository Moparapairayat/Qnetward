import Image from "next/image";
import dashboard from "../../../public/landing/dashboard.png";

/**
 * The hero shows the real console: a screenshot of the Overview page, cropped
 * where the hero ends. A 2px gap round the top lets a glow behind it light the
 * edge as it slides across. Phones show the whole shot, uncropped.
 */
export function HeroConsole() {
  return (
    <div className="relative mx-auto max-w-[1200px] overflow-hidden rounded-t-[14px] p-[2px] sm:rounded-t-[20px]">
      <span className="lp-hero-sweep" aria-hidden="true" />
      <div className="relative aspect-[1749/901] overflow-hidden sm:aspect-[5/2] rounded-t-[12px] border border-b-0 border-[var(--lp-bg)] bg-[#111113] sm:rounded-t-[18px]">
        <Image
          src={dashboard}
          alt="The Qnetward Overview: target count, average latency, packet loss, and alert rules, a response time chart per target, target health, and the targets table."
          sizes="(max-width: 1240px) 100vw, 1200px"
          placeholder="blur"
          priority
          className="block h-full w-full object-cover object-top"
        />
      </div>
    </div>
  );
}
