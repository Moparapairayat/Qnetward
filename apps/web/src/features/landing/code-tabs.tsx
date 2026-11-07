"use client";

import { useState } from "react";
import { Check, Copy } from "@/components/icons";

type Line = { text: string; tone?: "cmd" | "muted" | "ok" | "warn" | "accent" };

const tabs: { id: string; label: string; lines: Line[] }[] = [
  {
    id: "cli",
    label: "CLI",
    lines: [
      { text: "$ qnetward ping -count 4 1.1.1.1", tone: "cmd" },
      { text: "PING 1.1.1.1 (1.1.1.1) 32 bytes", tone: "muted" },
      { text: "seq=1  time=18.2 ms" },
      { text: "seq=2  time=17.9 ms" },
      { text: "seq=3  time=19.4 ms" },
      { text: "seq=4  time=18.1 ms" },
      { text: "4 sent · 4 received · 0% loss · avg 18.4 ms · jitter 0.6 ms", tone: "ok" },
      { text: "" },
      { text: "$ qnetward portscan -ports 22,80,443,8080 api.acme.dev", tone: "cmd" },
      { text: "443/tcp  open     12.1 ms", tone: "ok" },
      { text: "80/tcp   open     11.8 ms", tone: "ok" },
      { text: "22/tcp   filtered", tone: "warn" },
      { text: "8080/tcp closed", tone: "muted" },
    ],
  },
  {
    id: "api",
    label: "REST API",
    lines: [
      { text: "POST /api/tcpping", tone: "accent" },
      { text: "Content-Type: application/json", tone: "muted" },
      { text: "" },
      { text: '{ "host": "db.internal", "port": 5432, "count": 5, "interval_ms": 1000 }' },
      { text: "" },
      { text: "200 OK", tone: "ok" },
      { text: '{ "summary": { "sent": 5, "recv": 5, "loss": 0,' },
      { text: '  "avg": "3.1ms", "jitter": "0.2ms" } }' },
    ],
  },
  {
    id: "ws",
    label: "Live stream",
    lines: [
      { text: "ws://console/ws", tone: "accent" },
      { text: '→ { "type": "ping", "host": "8.8.8.8", "continuous": true }' },
      { text: '← { "type": "result", "result": { "seq": 1, "rtt_ms": 21.4 } }', tone: "ok" },
      { text: '← { "type": "result", "result": { "seq": 2, "rtt_ms": 20.9 } }', tone: "ok" },
      { text: '← { "type": "result", "result": { "seq": 3, "error": "timeout" } }', tone: "warn" },
      { text: '← { "type": "result", "result": { "seq": 4, "rtt_ms": 22.0 } }', tone: "ok" },
      { text: '→ { "type": "stop" }' },
      { text: '← { "type": "summary", "summary": { "loss": 25, "avg": "21.4ms" } }', tone: "muted" },
    ],
  },
];

const toneColor: Record<NonNullable<Line["tone"]>, string> = {
  cmd: "var(--lp-text)",
  muted: "var(--lp-subtle)",
  ok: "var(--lp-green)",
  warn: "var(--lp-amber)",
  accent: "var(--lp-accent)",
};

export function CodeTabs() {
  const [active, setActive] = useState(tabs[0].id);
  const [copied, setCopied] = useState(false);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];

  // Copy only what a reader would type: commands for the CLI, the whole example otherwise.
  const copyText = () => {
    const commands = tab.lines.filter((l) => l.tone === "cmd").map((l) => l.text.replace(/^\$ /, ""));
    const text = commands.length ? commands.join("\n") : tab.lines.map((l) => l.text).join("\n").trim();
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex w-full min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--lp-border)] bg-[#111114]">
      <div className="flex items-center border-b border-[var(--lp-border)]">
        <div role="tablist" aria-label="Usage examples" className="flex">
          {tabs.map((t) => {
            const selected = t.id === active;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => {
                  setActive(t.id);
                  setCopied(false);
                }}
                className="relative px-4 py-3 text-[13px] transition-colors"
                style={{ color: selected ? "var(--lp-text)" : "var(--lp-subtle)" }}
              >
                {t.label}
                {selected ? <span className="absolute inset-x-3 -bottom-px h-px bg-[var(--lp-accent)]" /> : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={copyText}
          className="ml-auto mr-2 inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--lp-subtle)] transition-colors hover:bg-white/[0.05] hover:text-[var(--lp-text)]"
          aria-label={copied ? "Copied" : `Copy ${tab.label} example`}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--lp-green)]" /> : <Copy className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre role="tabpanel" className="lp-mono min-h-[300px] flex-1 overflow-x-auto p-5 text-[12.5px] leading-6">
        {tab.lines.map((line, i) => (
          <div key={i} style={{ color: line.tone ? toneColor[line.tone] : "#c9c9d1" }}>
            {line.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
