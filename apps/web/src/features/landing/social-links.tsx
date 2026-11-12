import { DiscordLogo, EnvelopeSimple, LinkedinLogo, XLogo, YoutubeLogo } from "@phosphor-icons/react/dist/ssr";
import { GitHubIcon } from "./landing-nav";

// Placeholder accounts until the real ones exist: replace the URLs here and
// every place that shows social links picks them up.
export const socialLinks = [
  { label: "GitHub", href: "https://github.com/Quantum-Axis/Qnetward", icon: "github" },
  { label: "X", href: "https://x.com/qnetward", icon: "x" },
  { label: "LinkedIn", href: "https://www.linkedin.com/company/qnetward", icon: "linkedin" },
  { label: "Discord", href: "https://discord.gg/qnetward", icon: "discord" },
  { label: "YouTube", href: "https://www.youtube.com/@qnetward", icon: "youtube" },
  { label: "Email", href: "mailto:hello@qnetward.com", icon: "email" },
] as const;

function Icon({ name }: { name: (typeof socialLinks)[number]["icon"] }) {
  const props = { size: 17, weight: "fill" as const, "aria-hidden": true };
  switch (name) {
    case "github":
      return <GitHubIcon />;
    case "x":
      return <XLogo {...props} weight="bold" />;
    case "linkedin":
      return <LinkedinLogo {...props} />;
    case "discord":
      return <DiscordLogo {...props} />;
    case "youtube":
      return <YoutubeLogo {...props} />;
    case "email":
      return <EnvelopeSimple {...props} weight="bold" />;
  }
}

export function SocialLinks({ className = "" }: { className?: string }) {
  return (
    <ul className={`flex flex-wrap items-center gap-2 ${className}`} aria-label="Qnetward elsewhere">
      {socialLinks.map((s) => (
        <li key={s.label}>
          <a
            href={s.href}
            target={s.href.startsWith("mailto:") ? undefined : "_blank"}
            rel="noreferrer"
            aria-label={s.label}
            title={s.label}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--lp-border)] text-[var(--lp-muted)] transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-[var(--lp-text)]"
          >
            <Icon name={s.icon} />
          </a>
        </li>
      ))}
    </ul>
  );
}
