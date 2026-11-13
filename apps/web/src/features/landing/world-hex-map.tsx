import "flag-icons/css/flag-icons.min.css";
import { HEX_DX, HEX_DY, HEX_R, WORLD_H, WORLD_HEX_ROWS, WORLD_MARKERS, WORLD_W } from "./world-hex-data";

// Fill per country group (see world-hex-data generator): default, pink, cyan, violet, blue.
const GROUP_FILL = ["#262636", "#ff3d7f", "#22c3d6", "#8b5cf6", "#6366f1"];
const GROUP_OPACITY = [1, 0.85, 0.8, 0.8, 0.75];


/** One path per group keeps the DOM to a handful of nodes instead of thousands of polygons. */
function buildPaths() {
  const r = HEX_R * 0.86; // small gap between hexes
  const corner: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    corner.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  const hex = (cx: number, cy: number) =>
    `M${(cx + corner[0][0]).toFixed(1)},${(cy + corner[0][1]).toFixed(1)}` +
    corner
      .slice(1)
      .map(([x, y]) => `L${(cx + x).toFixed(1)},${(cy + y).toFixed(1)}`)
      .join("") +
    "Z";

  const paths = GROUP_FILL.map(() => [] as string[]);
  for (const line of WORLD_HEX_ROWS) {
    const [rowStr, cellsStr] = line.split(":");
    const row = Number(rowStr);
    const cy = HEX_R + row * HEX_DY;
    const offset = row % 2 ? HEX_DX / 2 : 0;
    for (const part of cellsStr.split(",")) {
      const [range, groupStr] = part.split(".");
      const [start, end = start] = range.split("-").map(Number);
      const group = Number(groupStr);
      for (let col = start; col <= end; col++) {
        paths[group].push(hex(HEX_DX / 2 + offset + col * HEX_DX, cy));
      }
    }
  }
  return paths.map((p) => p.join(""));
}

const PATHS = buildPaths();

// Labels that sit left of their marker so neighbours (London/Frankfurt, Mumbai/Dhaka) don't collide.
const LABEL_LEFT = new Set(["gb", "in", "au"]);
const hub = WORLD_MARKERS.find((m) => m.primary) ?? WORLD_MARKERS[0];

function arc(x1: number, y1: number, x2: number, y2: number) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const lift = Math.min(140, Math.hypot(x2 - x1, y2 - y1) * 0.35);
  return `M${x1},${y1} Q${mx},${my - lift} ${x2},${y2}`;
}

export function WorldHexMap() {
  return (
    <div className="relative w-full" style={{ aspectRatio: `${WORLD_W} / ${WORLD_H}` }}>
      <svg viewBox={`0 0 ${WORLD_W} ${WORLD_H}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <filter id="lp-map-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="lp-arc" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff3d7f" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0.6" />
          </linearGradient>
        </defs>

        {PATHS.map((d, group) => (
          <path key={group} d={d} fill={GROUP_FILL[group]} fillOpacity={GROUP_OPACITY[group]} />
        ))}

        {/* connections from the primary region */}
        <g filter="url(#lp-map-glow)">
          {WORLD_MARKERS.filter((m) => m.id !== hub.id).map((m, i) => (
            <path
              key={m.id}
              d={arc(hub.x, hub.y, m.x, m.y)}
              fill="none"
              stroke="url(#lp-arc)"
              strokeWidth="1.1"
              strokeLinecap="round"
              className="lp-map-arc"
              style={{ animationDelay: `${i * 0.35}s` }}
            />
          ))}
          {WORLD_MARKERS.map((m) => (
            <g key={m.id}>
              <circle cx={m.x} cy={m.y} r={m.primary ? 9 : 6} fill={m.primary ? "#ff3d7f" : "#ffffff"} opacity="0.18" className="lp-map-ping" />
              <circle cx={m.x} cy={m.y} r={m.primary ? 3.6 : 2.6} fill={m.primary ? "#ff3d7f" : "#ffffff"} />
            </g>
          ))}
        </g>
      </svg>

      {/* country / region labels */}
      {WORLD_MARKERS.map((m) => {
        const flipLeft = LABEL_LEFT.has(m.id) || m.x > WORLD_W * 0.88;
        return (
          <div
            key={m.id}
            className="pointer-events-none absolute hidden sm:block"
            style={{
              left: `${(m.x / WORLD_W) * 100}%`,
              top: `${(m.y / WORLD_H) * 100}%`,
              transform: flipLeft ? "translate(calc(-100% - 12px), -50%)" : "translate(12px, -50%)",
            }}
          >
            <div
              className="flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-2xs shadow-lg backdrop-blur"
              style={{
                background: "rgba(22, 22, 30, 0.82)",
                borderColor: m.primary ? "rgba(255, 61, 127, 0.5)" : "var(--lp-border-strong)",
              }}
            >
              <span className={`fi fi-${m.id} rounded-[2px]`} style={{ width: 16, height: 12, backgroundSize: "cover" }} />
              <span className="font-medium text-[var(--lp-text)]">{m.name}</span>
              <span className="lp-mono text-3xs" style={{ color: m.primary ? "var(--lp-accent)" : "var(--lp-subtle)" }}>
                {m.primary ? "primary" : "planned"}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
