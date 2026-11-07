import { Bot, MessageSquare, Send, Sparkles } from "@/components/icons";

/* Illustrative visuals for feature previews. All data below is sample data. */

const card = "rounded-xl border border-[var(--lp-border)] bg-[#1b1b1f]";

export function TopologyVisual() {
  const nodes = [
    { id: "isp", x: 400, y: 40, label: "ISP uplink", kind: "cloud" },
    { id: "rtr", x: 400, y: 120, label: "edge-rtr-dac", kind: "router" },
    { id: "fw", x: 400, y: 200, label: "fw-hq", kind: "firewall" },
    { id: "core", x: 400, y: 280, label: "core-sw-01", kind: "switch" },
    { id: "a1", x: 180, y: 370, label: "access-sw-a", kind: "switch" },
    { id: "a2", x: 400, y: 370, label: "access-sw-b", kind: "switch" },
    { id: "a3", x: 620, y: 370, label: "dc-tor-01", kind: "switch" },
    { id: "s1", x: 560, y: 450, label: "db-master-01", kind: "server" },
    { id: "s2", x: 680, y: 450, label: "api-prod-01", kind: "server" },
    { id: "ap", x: 120, y: 450, label: "ap-floor-2", kind: "wifi" },
    { id: "ap2", x: 240, y: 450, label: "ap-floor-3", kind: "wifi" },
  ];
  const links: [string, string, "ok" | "warn" | "bad"][] = [
    ["isp", "rtr", "ok"],
    ["rtr", "fw", "ok"],
    ["fw", "core", "ok"],
    ["core", "a1", "ok"],
    ["core", "a2", "warn"],
    ["core", "a3", "ok"],
    ["a3", "s1", "bad"],
    ["a3", "s2", "ok"],
    ["a1", "ap", "ok"],
    ["a1", "ap2", "ok"],
  ];
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const linkColor = { ok: "rgba(255,255,255,0.22)", warn: "#fbbf24", bad: "#ff3d7f" };
  const nodeColor: Record<string, string> = {
    cloud: "#a78bfa",
    router: "#22c3d6",
    firewall: "#fbbf24",
    switch: "#ededf0",
    server: "#4ade80",
    wifi: "#a78bfa",
  };
  return (
    <section className={`${card} p-5`}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-[14px] font-medium">Headquarters · layer 2/3</h2>
        <span className="flex gap-4 text-[12px] text-[var(--lp-subtle)]">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-[#fbbf24]" /> errors
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 bg-[#ff3d7f]" /> down
          </span>
        </span>
      </div>
      <svg viewBox="0 0 800 490" className="mt-3 w-full" role="img" aria-label="Sample network topology">
        {links.map(([a, b, s]) => {
          const p = pos.get(a)!;
          const q = pos.get(b)!;
          return (
            <line
              key={a + b}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              stroke={linkColor[s]}
              strokeWidth={s === "ok" ? 1.5 : 2}
              strokeDasharray={s === "bad" ? "5 4" : undefined}
            />
          );
        })}
        {nodes.map((n) => (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r="14" fill="#1d1d22" stroke={nodeColor[n.kind]} strokeWidth="1.5" />
            <circle cx={n.x} cy={n.y} r="4" fill={nodeColor[n.kind]} />
            <text x={n.x} y={n.y + 30} textAnchor="middle" fontSize="11" fill="#9a9aa3" stroke="#1b1b1f" strokeWidth="4" paintOrder="stroke">
              {n.label}
            </text>
          </g>
        ))}
      </svg>
    </section>
  );
}

export function AssistantVisual() {
  return (
    <section className={`${card} flex flex-col`}>
      <div className="flex items-center gap-2 border-b border-[var(--lp-border)] px-5 py-3 text-[13px]">
        <Sparkles className="h-4 w-4 text-[var(--lp-accent)]" /> Ask Qnetward
      </div>
      <div className="space-y-5 p-5 text-[14px]">
        <div className="flex justify-end">
          <p className="max-w-[80%] rounded-xl rounded-br-sm bg-white/[0.06] px-4 py-2.5">
            Which target had the most packet loss in the last 3 days, and why?
          </p>
        </div>
        <div className="flex gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[rgba(255,61,127,0.12)]">
            <Bot className="h-4 w-4 text-[var(--lp-accent)]" />
          </span>
          <div className="space-y-3 text-[var(--lp-muted)]">
            <p>
              <span className="text-[var(--lp-text)]">Mail MX (TCP 25)</span> lost 8.4% of probes, all from Frankfurt between 02:10 and 02:55 on Oct
              30.
            </p>
            <p>
              During the same window, <span className="text-[var(--lp-text)]">edge-rtr-dac</span> logged a BGP session reset with its upstream, and
              traceroutes from FRA shifted to a longer path through AS3356. Probes from Singapore and Dhaka were unaffected, so the likely cause is a
              routing change upstream of Frankfurt rather than the mail server.
            </p>
            <div className="flex flex-wrap gap-2 text-[12px]">
              {["History · Mail MX", "Logs · edge-rtr-dac", "Traceroute · FRA"].map((s) => (
                <span key={s} className="rounded-md border border-[var(--lp-border)] px-2 py-1">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="m-4 mt-auto flex items-center gap-2 rounded-lg border border-[var(--lp-border-strong)] px-3 py-2.5 text-[13px] text-[var(--lp-subtle)]">
        <MessageSquare className="h-4 w-4" />
        <span className="flex-1">Ask about latency, outages, devices, or findings…</span>
        <Send className="h-4 w-4" />
      </div>
    </section>
  );
}

export function FlowsVisual() {
  const talkers = [
    { name: "10.0.4.21 → s3.ap-southeast-1", app: "HTTPS", gbps: 0.62 },
    { name: "10.0.8.10 → 104.18.0.0/16", app: "HTTPS", gbps: 0.41 },
    { name: "10.0.2.5 → backup-fra", app: "SSH/rsync", gbps: 0.28 },
    { name: "10.0.6.0/24 → youtube.com", app: "QUIC", gbps: 0.19 },
    { name: "10.0.4.30 → 185.199.108.0/22", app: "HTTPS", gbps: 0.11 },
  ];
  const max = talkers[0].gbps;
  return (
    <section className={`${card} p-5`}>
      <h2 className="text-[14px] font-medium">Top conversations, last hour</h2>
      <ul className="mt-4 space-y-3 text-[13px]">
        {talkers.map((t, idx) => (
          <li key={t.name}>
            <div className="mb-1.5 flex justify-between gap-4">
              <span className="truncate">{t.name}</span>
              <span className="lp-mono shrink-0 text-[var(--lp-muted)]">
                {t.gbps.toFixed(2)} Gbps · {t.app}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/[0.06]">
              <div
                className="h-2 rounded-full"
                style={{ width: `${(t.gbps / max) * 100}%`, background: ["#ff3d7f", "#a78bfa", "#22c3d6", "#4ade80", "#fbbf24"][idx] }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TimelineVisual() {
  const events = [
    ["20:29", "Alert", "Mail MX TCP 25 failing from Frankfurt (3 of 3 probes)", "#ff3d7f"],
    ["20:30", "Paged", "Tanvir K. paged via push and SMS", "#a78bfa"],
    ["20:32", "Acknowledged", "Tanvir K. acknowledged", "#22c3d6"],
    ["20:36", "Update", "Singapore and Dhaka probes healthy. Looking at FRA routing.", "#9a9aa3"],
    ["20:41", "Linked", "BGP reset on edge-rtr-dac attached from logs", "#fbbf24"],
  ];
  return (
    <section className={`${card} p-5`}>
      <h2 className="text-[14px] font-medium">Timeline · Mail MX unreachable from FRA</h2>
      <ol className="mt-4 space-y-4 border-l border-[var(--lp-border)] pl-5">
        {events.map(([time, kind, text, color]) => (
          <li key={time + kind} className="relative text-[13px]">
            <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-[#1b1b1f]" style={{ background: color }} />
            <span className="lp-mono mr-2 text-[var(--lp-subtle)]">{time}</span>
            <span className="mr-2 text-[var(--lp-text)]">{kind}</span>
            <span className="text-[var(--lp-muted)]">{text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ScheduleVisual() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const people = [
    { name: "Tanvir K.", color: "#ff3d7f", days: [0, 1, 2] },
    { name: "Ayesha R.", color: "#a78bfa", days: [3, 4] },
    { name: "Mitu S.", color: "#22c3d6", days: [5, 6] },
  ];
  return (
    <section className={`${card} p-5`}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-[14px] font-medium">NOC primary · this week</h2>
        <span className="text-[12px] text-[var(--lp-subtle)]">handoff Mon 09:00</span>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[12px] text-[var(--lp-subtle)]">
        {days.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-2 space-y-2">
        {people.map((p) => (
          <div key={p.name} className="grid grid-cols-7 gap-1">
            {days.map((_, idx) => (
              <span
                key={idx}
                className="flex h-8 items-center justify-center truncate rounded-md px-1 text-[11px]"
                style={{
                  background: p.days.includes(idx) ? `${p.color}26` : "rgba(255,255,255,0.03)",
                  color: p.days.includes(idx) ? p.color : "transparent",
                }}
              >
                {p.days[0] === idx ? p.name : ""}
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
