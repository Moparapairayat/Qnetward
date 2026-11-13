"use client";

import Image, { type StaticImageData } from "next/image";
import { useState } from "react";
import { Activity, BellRing, Globe, History, Radar, Radio } from "@/components/icons";
import { cn } from "@/lib/utils";
import pingShot from "../../../public/landing/tool-ping.jpg";
import portscanShot from "../../../public/landing/tool-portscan.jpg";
import dnsShot from "../../../public/landing/tool-dns.jpg";
import alertsShot from "../../../public/landing/tool-alerts.jpg";
import monitorsShot from "../../../public/landing/tool-monitors.jpg";
import historyShot from "../../../public/landing/tool-history.jpg";

type Tool = {
  id: string;
  name: string;
  body: string;
  path: string;
  icon: typeof Activity;
  image: StaticImageData;
  alt: string;
};

// Screenshots are taken from the console itself (demo workspace, 2x). Retake them when a tool page changes.
const tools: Tool[] = [
  {
    id: "ping",
    name: "Ping and TCP ping",
    body: "Replies stream in as they arrive. A live latency chart, loss and jitter as you watch, and a stop button that stops.",
    path: "tcp-ping",
    icon: Activity,
    image: pingShot,
    alt: "TCP ping to cloudflare.com on port 443, running: 13 of 13 replies, average 122 ms, and a live latency chart.",
  },
  {
    id: "monitors",
    name: "Uptime monitors",
    body: "Websites, APIs, and servers checked every minute to every hour, with the tab closed. The last 30 checks at a glance, and certificate expiry for HTTPS.",
    path: "monitors",
    icon: Radio,
    image: monitorsShot,
    alt: "Monitors page: five monitors, one down with a 404 and four up, each with a strip of its last checks, 24-hour uptime, and certificate expiry.",
  },
  {
    id: "portscan",
    name: "Port scan",
    body: "Up to 4,096 ports per run with 256 parallel connections. A port map, service names, and handshake time for each open port.",
    path: "port-scan",
    icon: Radar,
    image: portscanShot,
    alt: "Port scan of 1.1.1.1 across 18 ports: 6 open, 12 filtered, shown as a colour-coded port map and a results table.",
  },
  {
    id: "dns",
    name: "DNS lookup",
    body: "Every record type against the resolver you choose, with TTLs, DNSSEC status, and a check of the domain's mail records.",
    path: "dns-lookup",
    icon: Globe,
    image: dnsShot,
    alt: "DNS lookup of cloudflare.com: 29 records, mail and DNSSEC checks, and A, AAAA, NS, and MX records with TTLs.",
  },
  {
    id: "alerts",
    name: "Alert rules",
    body: "Latency and loss thresholds checked after every ping, yours or a monitor's. Cooldowns mean one bad minute sends one email, not twenty.",
    path: "alerts",
    icon: BellRing,
    image: alertsShot,
    alt: "Alert rules page with a firing latency rule for github.com:443 and the form to create a new rule.",
  },
  {
    id: "history",
    name: "History and export",
    body: "Every probe is stored. Chart a target over time, filter the failures, and export CSV or JSON for the incident review.",
    path: "history",
    icon: History,
    image: historyShot,
    alt: "History for github.com:443: success rate, p95 latency, a latency chart, and the stored samples.",
  },
];

/**
 * Product section: pick a tool on the left, see that tool's real console page
 * on the right. No autoplay; the selection only changes when the reader asks.
 */
export function ProductShowcase() {
  const [activeId, setActiveId] = useState(tools[0].id);
  const active = tools.find((t) => t.id === activeId) ?? tools[0];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-10">
      <div className="min-w-0">
        <div role="tablist" aria-label="Product tools" className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
          {tools.map((tool) => {
            const selected = tool.id === activeId;
            return (
              <button
                key={tool.id}
                type="button"
                role="tab"
                id={`tool-tab-${tool.id}`}
                aria-selected={selected}
                aria-controls="tool-panel"
                onClick={() => setActiveId(tool.id)}
                className={cn(
                  "group relative shrink-0 rounded-lg border text-left transition-colors lg:w-full lg:border-transparent",
                  "px-3.5 py-2 lg:px-4 lg:py-3.5",
                  selected
                    ? "border-[var(--lp-border-strong)] bg-white/[0.05] lg:border-transparent"
                    : "border-[var(--lp-border)] hover:bg-white/[0.025] lg:border-transparent",
                )}
              >
                {selected ? <span className="absolute bottom-3 left-0 top-3 hidden w-[2px] rounded-full bg-[var(--lp-accent)] lg:block" aria-hidden="true" /> : null}
                <span className="flex items-center gap-2.5">
                  <tool.icon className={cn("h-4 w-4 shrink-0", selected ? "text-[var(--lp-accent)]" : "text-[var(--lp-subtle)] group-hover:text-[var(--lp-muted)]")} aria-hidden="true" />
                  <span className={cn("whitespace-nowrap text-base lg:text-md", selected ? "text-[var(--lp-text)]" : "text-[var(--lp-muted)]")}>{tool.name}</span>
                </span>
                <span
                  className={cn(
                    "hidden overflow-hidden pl-[26px] text-base leading-relaxed text-[var(--lp-muted)] transition-[max-height,opacity,margin] duration-300 lg:block",
                    selected ? "mt-1.5 max-h-40 opacity-100" : "max-h-0 opacity-0",
                  )}
                >
                  {tool.body}
                </span>
              </button>
            );
          })}
        </div>
        {/* On small screens the description sits under the tabs instead of inside them. */}
        <p className="mt-4 text-base leading-relaxed text-[var(--lp-muted)] lg:hidden">{active.body}</p>
      </div>

      <div id="tool-panel" role="tabpanel" aria-labelledby={`tool-tab-${active.id}`} className="min-w-0">
        <div className="overflow-hidden rounded-xl border border-[var(--lp-border-strong)] bg-[#17171b] shadow-[0_30px_90px_rgba(0,0,0,0.45)]">
          <div className="flex h-9 items-center gap-2 border-b border-[var(--lp-border)] px-4" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
            <span className="lp-mono ml-4 truncate text-2xs text-[var(--lp-subtle)]">console.qnetward.com/{active.path}</span>
          </div>
          {/* All screens stay mounted and cross-fade, so switching tools never shifts the layout. */}
          <div className="relative aspect-[1184/800]">
            {tools.map((tool) => (
              <Image
                key={tool.id}
                src={tool.image}
                alt={tool.id === activeId ? tool.alt : ""}
                aria-hidden={tool.id === activeId ? undefined : true}
                fill
                sizes="(max-width: 1024px) 100vw, 800px"
                placeholder="blur"
                className={cn("object-cover object-top transition-opacity duration-300", tool.id === activeId ? "opacity-100" : "opacity-0")}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
