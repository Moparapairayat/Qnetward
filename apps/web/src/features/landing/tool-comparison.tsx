import { Clock, FileSpreadsheet, Globe, Laptop, SquareTerminal, type AppIcon } from "@/components/icons";
import { QnetwardMark } from "./qnetward-mark";

const rows: { before: string; after: string; icon: AppIcon }[] = [
  { before: "ping and mtr in a terminal", after: "Live ICMP and TCP ping with loss streaks and jitter", icon: SquareTerminal },
  { before: "nmap on someone's laptop", after: "Port scans saved to history, visible to the team", icon: Laptop },
  { before: "dig, nslookup, and a DNS website", after: "DNS inspector with DNSSEC and reverse lookups", icon: Globe },
  { before: "A separate uptime checker", after: "HTTP(S), TCP, and ping monitors with certificate expiry warnings", icon: Clock },
  { before: "A spreadsheet of client sites", after: "One workspace per client, with roles", icon: FileSpreadsheet },
];

export function ToolComparison() {
  return (
    <div className="lp-reveal overflow-hidden rounded-2xl border border-[var(--lp-border)]">
      <div className="grid grid-cols-2 border-b border-[var(--lp-border)] bg-[var(--lp-bg-raised)] text-[13px]">
        <div className="px-5 py-4 text-[var(--lp-subtle)] sm:px-8">What you use now</div>
        <div className="flex items-center gap-2 border-l border-[var(--lp-border)] bg-[rgba(255,61,127,0.05)] px-5 py-4 text-[var(--lp-text)] sm:px-8">
          <QnetwardMark size={16} />
          In Qnetward
        </div>
      </div>
      <ul>
        {rows.map((row, i) => (
          <li key={row.before} className={`grid grid-cols-2 text-[14px] ${i > 0 ? "border-t border-[var(--lp-border)]" : ""}`}>
            <div className="flex gap-3 px-5 py-5 text-[var(--lp-subtle)] sm:px-8">
              <row.icon className="mt-[2px] hidden h-4 w-4 shrink-0 opacity-60 sm:block" aria-hidden="true" />
              <span className="line-through decoration-[rgba(255,255,255,0.18)]">{row.before}</span>
            </div>
            <div className="flex gap-3 border-l border-[var(--lp-border)] bg-[rgba(255,61,127,0.025)] px-5 py-5 text-[var(--lp-text)] sm:px-8">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="mt-[3px] shrink-0">
                <path d="M3.5 8.5 6.5 11.5 12.5 4.5" stroke="var(--lp-green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {row.after}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
