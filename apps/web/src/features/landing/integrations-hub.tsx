import Link from "next/link";
import type { ComponentType } from "react";
import { KeyRound, Mail, Webhook } from "@/components/icons";
import { DiscordLogo, SlackLogo, TelegramLogo } from "@/components/brand-logos";
import { QnetwardMark } from "./qnetward-mark";

type Spot = {
  name: string;
  icon: ComponentType<{ className?: string }>;
  tint?: string;
  big?: boolean;
  /** Direction of the lit rim, pointing back at the centre. */
  angle: number;
};

// Only channels that ship today, plus the API anything else can be scripted against.
const left: Spot[] = [
  { name: "Slack", icon: SlackLogo, angle: 330 },
  { name: "Discord", icon: DiscordLogo, big: true, angle: 270 },
  { name: "Email", icon: Mail, tint: "#ededf0", angle: 220 },
];
const right: Spot[] = [
  { name: "Webhook", icon: Webhook, tint: "#ff8fb3", angle: 45 },
  { name: "Telegram", icon: TelegramLogo, big: true, angle: 90 },
  { name: "REST API", icon: KeyRound, tint: "#fcd34d", angle: 135 },
];

function Circle({ spot }: { spot: Spot }) {
  return (
    <li
      className={`lp-int-rim ${spot.big ? "lp-int-lg" : "lp-int-sm"}`}
      style={{ ["--rim" as string]: `${spot.angle}deg` }}
      title={spot.name}
    >
      <span className="lp-int-round" style={spot.tint ? { color: spot.tint } : undefined}>
        <spot.icon className="lp-int-icon" />
      </span>
      <span className="sr-only">{spot.name}</span>
    </li>
  );
}

/** Qnetward in the middle, the places it sends alerts round it. */
export function IntegrationsHub() {
  return (
    <div className="lp-hero-type mx-auto max-w-[740px] text-center">
      <h2 className="lp-heading-fade lp-reveal text-[32px] font-semibold leading-[1.1] sm:text-[48px]">
        Alerts where your team works
      </h2>

      <div className="lp-int-grid lp-reveal mt-[50px]">
        <ul className="lp-int-col lp-int-col-left">
          {left.map((s) => (
            <Circle key={s.name} spot={s} />
          ))}
        </ul>

        <div className="lp-int-center">
          <span className="lp-int-mark">
            <QnetwardMark size={60} />
          </span>
          <span className="sr-only">Qnetward</span>
        </div>

        <ul className="lp-int-col lp-int-col-right">
          {right.map((s) => (
            <Circle key={s.name} spot={s} />
          ))}
        </ul>
      </div>

      <div className="lp-reveal mt-[50px] flex flex-col items-center gap-5">
        <p className="text-sm font-medium text-[#a6a6a6]">
          Send alerts to Slack, Discord, Telegram, email, or a signed webhook, and script the rest with the API.
        </p>
        <Link href="/workspace/integrations" className="lp-int-button">
          Connect your channels
          <svg width="12" height="10" viewBox="0 0 12 10" fill="none" aria-hidden="true">
            <path d="M1 5h10M7 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
