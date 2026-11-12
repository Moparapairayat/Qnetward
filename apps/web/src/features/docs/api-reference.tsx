"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import { useMemo } from "react";

// Scalar's variables, set to the console's palette so the reference feels
// like part of Qnetward rather than an embedded tool.
const customCss = `
.dark-mode {
  --scalar-background-1: #111114;
  --scalar-background-2: #18181c;
  --scalar-background-3: #202026;
  --scalar-background-accent: rgba(255, 61, 127, 0.1);
  --scalar-color-1: #ededf0;
  --scalar-color-2: #a1a1aa;
  --scalar-color-3: #71717a;
  --scalar-color-accent: #ff4d8b;
  --scalar-border-color: rgba(255, 255, 255, 0.08);
  --scalar-button-1: #ff3d7f;
  --scalar-button-1-color: #ffffff;
  --scalar-button-1-hover: #ff5a93;
  --scalar-color-green: #4ade80;
  --scalar-color-red: #ff6b9a;
  --scalar-color-yellow: #fbbf24;
  --scalar-color-blue: #60a5fa;
  --scalar-color-orange: #fb923c;
  --scalar-color-purple: #a78bfa;
  --scalar-sidebar-background-1: #0d0d10;
  --scalar-sidebar-item-hover-background: rgba(255, 255, 255, 0.04);
  --scalar-sidebar-item-active-background: rgba(255, 61, 127, 0.1);
  --scalar-sidebar-color-active: #ff4d8b;
  --scalar-sidebar-border-color: rgba(255, 255, 255, 0.06);
  --scalar-sidebar-search-background: #18181c;
  --scalar-sidebar-search-border-color: rgba(255, 255, 255, 0.08);
}
.light-mode, .dark-mode {
  --scalar-font: var(--font-geist), ui-sans-serif, system-ui, sans-serif;
  --scalar-font-code: var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace;
  --scalar-radius: 8px;
  --scalar-radius-lg: 12px;
  --scalar-radius-xl: 14px;
  --scalar-custom-header-height: 56px;
}
.scalar-app .references-layout { min-height: calc(100dvh - 56px); }
/* Each example has its own language picker, which applies page-wide, so the
   separate Client Libraries card only repeats it. */
.introduction-card-item:has(.client-libraries) { display: none; }
`;

export function ApiReference() {
  // Requests from the "Try it" panel go to whichever console serves this page.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const configuration = useMemo(
    () => ({
      url: "/openapi.yaml",
      theme: "none" as const,
      layout: "modern" as const,
      darkMode: true,
      forceDarkModeState: "dark" as const,
      hideDarkModeToggle: true,
      withDefaultFonts: false,
      customCss,
      servers: origin ? [{ url: origin, description: "This console" }] : undefined,
      authentication: { preferredSecurityScheme: "apiKey" },
      persistAuth: false,
      defaultHttpClient: { targetKey: "shell" as const, clientKey: "curl" as const },
      featuredClients: ["shell/curl", "js/fetch", "python/requests", "go/native", "node/fetch"],
      documentDownloadType: "yaml" as const,
      showDeveloperTools: "never" as const,
      telemetry: false,
      // No third-party AI chat on our docs.
      agent: { disabled: true },
      mcp: { disabled: true },
      metaData: { title: "Qnetward API reference" },
    }),
    [origin],
  );
  return <ApiReferenceReact configuration={configuration as Parameters<typeof ApiReferenceReact>[0]["configuration"]} />;
}
