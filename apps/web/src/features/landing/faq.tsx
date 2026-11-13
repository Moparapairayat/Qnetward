const items = [
  {
    q: "Do I need to install anything to start?",
    a: "No. Sign up and run ICMP ping, TCP ping, port scans, and DNS lookups straight from the console. Agents for probing inside private networks are coming next.",
  },
  {
    q: "Can I scan any host or domain?",
    a: "Diagnostics like ping and DNS work on any public target. Deeper security scanning will only run on assets you have verified you own, with rate limits and a full audit trail.",
  },
  {
    q: "Can my whole team use one account?",
    a: "Yes. Create a workspace, invite teammates by email, and give each person a role: owner, admin, or member. You can belong to several workspaces and switch between them.",
  },
  {
    q: "Where is my data stored?",
    a: "Results live in PostgreSQL with TimescaleDB in our primary region, Singapore. Per-region data residency is on the roadmap before we onboard customers who need it.",
  },
  {
    q: "Can I self-host Qnetward?",
    a: "The stack ships as Docker Compose today (API, dashboard, TimescaleDB, Redis, S3-compatible storage). A supported self-hosted edition is planned for enterprise teams.",
  },
  {
    q: "How do I get alerted?",
    a: "Add a monitor and you get an email when it goes down, when it comes back, and two weeks before an HTTPS certificate expires. Alert rules add latency and loss thresholds on top. Slack, Telegram, Discord, and webhooks are next.",
  },
];

export function Faq() {
  return (
    <div className="divide-y divide-[var(--lp-border)] rounded-xl border border-[var(--lp-border)] bg-[var(--lp-bg-raised)]">
      {items.map((item) => (
        <details key={item.q} className="lp-faq group px-5 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-md font-medium">
            {item.q}
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--lp-border)] text-[var(--lp-muted)] transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="pb-5 pr-10 text-base leading-relaxed text-[var(--lp-muted)]">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
