import {
  siApple,
  siCisco,
  siDell,
  siDocker,
  siFortinet,
  siGrafana,
  siKubernetes,
  siLinux,
  siMikrotik,
  siPfsense,
  siPostgresql,
  siProxmox,
  siRaspberrypi,
  siRedis,
  siTelegram,
  siTimescale,
  siUbiquiti,
  type SimpleIcon,
} from "simple-icons";

// Logos are from Simple Icons (CC0). They show what Qnetward runs on or will integrate with;
// they do not imply partnership or endorsement.
const today: { icon: SimpleIcon; note: string }[] = [
  { icon: siLinux, note: "CLI and server" },
  { icon: siApple, note: "CLI" },
  { icon: siRaspberrypi, note: "CLI on ARM" },
  { icon: siDocker, note: "Self-host stack" },
  { icon: siPostgresql, note: "Primary database" },
  { icon: siTimescale, note: "Time-series history" },
  { icon: siRedis, note: "History cache" },
];

const planned: { icon: SimpleIcon; note: string }[] = [
  { icon: siCisco, note: "SNMP, gNMI" },
  { icon: siMikrotik, note: "SNMP, API" },
  { icon: siUbiquiti, note: "UniFi API" },
  { icon: siFortinet, note: "Syslog, API" },
  { icon: siPfsense, note: "Syslog, SNMP" },
  { icon: siDell, note: "Redfish (iDRAC)" },
  { icon: siKubernetes, note: "Agent DaemonSet" },
  { icon: siProxmox, note: "Collector VM" },
  { icon: siGrafana, note: "Dashboards" },
  { icon: siTelegram, note: "Alert channel" },
];

/** Brand colours that are too dark to read on the dark page fall back to white on hover. */
function hoverColor(hex: string) {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.35 ? "#ffffff" : `#${hex}`;
}

function LogoRow({ items, dim = false }: { items: { icon: SimpleIcon; note: string }[]; dim?: boolean }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-1 gap-y-2 sm:gap-x-2">
      {items.map(({ icon, note }) => (
        <li key={icon.slug}>
          <span
            className={`lp-logo group relative flex h-11 w-11 items-center justify-center rounded-lg ${dim ? "opacity-60" : ""}`}
            style={{ ["--brand" as string]: hoverColor(icon.hex) }}
            title={`${icon.title} — ${note}`}
          >
            <svg role="img" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-label={icon.title}>
              <path d={icon.path} />
            </svg>
            <span className="pointer-events-none absolute -bottom-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap sm:block rounded-md border border-[var(--lp-border)] bg-[var(--lp-bg-raised)] px-2 py-0.5 text-2xs text-[var(--lp-muted)] opacity-0 transition-opacity group-hover:opacity-100">
              {icon.title} · {note}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function TechLogos() {
  return (
    <div className="grid gap-10 lg:grid-cols-[auto_1fr] lg:gap-16">
      <div>
        <div className="mb-3 text-xs text-[var(--lp-muted)]">Runs on today</div>
        <LogoRow items={today} />
      </div>
      <div className="lg:border-l lg:border-[var(--lp-border)] lg:pl-16">
        <div className="mb-3 text-xs text-[var(--lp-subtle)]">Integrations in development</div>
        <LogoRow items={planned} dim />
      </div>
    </div>
  );
}
