import type { Metadata } from "next";
import { Activity, FileText, KeyRound, Webhook } from "@/components/icons";
import { BASE_URL } from "@/features/docs/docs-nav";
import { A, Article, Block, C, Card, Cards, Eyebrow, Fields, H2, Lead, List, P, Title } from "@/features/docs/docs-ui";
import { CodeBlock } from "@/features/docs/docs-code";

export const metadata: Metadata = {
  title: "Docs",
  description: "Use Qnetward from scripts, CI, and your own tools: authentication, errors, rate limits, webhooks, live events, and every endpoint.",
};

// The terminal at the top: a request, then its answer a line at a time.
const term: { text: string; tone?: string }[] = [
  { text: `$ curl -X POST ${BASE_URL}/api/ping \\`, tone: "cmd" },
  { text: `    -H "Authorization: Bearer $QNETWARD_API_KEY" \\`, tone: "cmd" },
  { text: `    -d '{"host": "1.1.1.1", "count": 3}'`, tone: "cmd" },
  { text: "" },
  { text: "{" },
  { text: '  "protocol": "icmp",', tone: "kv" },
  { text: '  "target": "1.1.1.1",', tone: "kv" },
  { text: '  "summary": {', tone: "kv" },
  { text: '    "sent": 3, "recv": 3, "loss": 0,', tone: "kv" },
  { text: '    "avg": "18.5ms", "jitter": "0.9ms"', tone: "kv" },
  { text: "  }" },
  { text: "}" },
];

const toc = [
  { id: "base-url", label: "Base URL" },
  { id: "start-here", label: "Start here" },
  { id: "what-you-can-do", label: "What you can do" },
  { id: "conventions", label: "Conventions" },
];

export default function DocsHome() {
  return (
    <Article toc={toc}>
      <Eyebrow>Qnetward API · v1</Eyebrow>
      <Title>Build on your network data</Title>
      <Lead>
        Everything you can do in the console, you can do over HTTP: run probes, manage monitors and alert rules, read history, and
        stream what happens as it happens. One key, plain JSON, no SDK required.
      </Lead>

      <div className="docs-glow relative mt-8 overflow-hidden rounded-2xl border border-[var(--d-border)] bg-[#0b0b0e]" aria-label="Example request and response">
        <div className="flex h-9 items-center gap-1.5 border-b border-[var(--d-border)] px-4" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="docs-mono ml-3 text-[12px] text-[var(--d-subtle)]">Your first probe</span>
        </div>
        <pre className="docs-pre relative text-[12.5px] sm:text-[13px]">
          {term.map((l, i) => (
            <span
              key={i}
              className={`docs-term-line block min-h-[1.7em] ${l.tone === "cmd" ? "text-[var(--d-text)]" : l.tone === "kv" ? "text-[#a7f3d0]" : "text-[#d4d4d8]"}`}
              style={{ animationDelay: `${300 + i * (l.tone === "cmd" ? 120 : 70) + (i > 3 ? 400 : 0)}ms` }}
            >
              {l.text}
            </span>
          ))}
          <span className="docs-term-line docs-caret block" style={{ animationDelay: "1600ms" }} />
        </pre>
      </div>

      <H2 id="base-url">Base URL</H2>
      <P>
        Every path in these docs is relative to your console. On the hosted service that&apos;s the address below; if you run
        Qnetward yourself, use your own.
      </P>
      <Block>
        <CodeBlock code={BASE_URL} lang="bash" title="Hosted service" />
      </Block>

      <H2 id="start-here">Start here</H2>
      <Cards>
        <Card href="/docs/quickstart" title="Quickstart" icon={Activity}>
          A key, your first request, and a monitor created from code, in about five minutes.
        </Card>
        <Card href="/docs/authentication" title="Authentication" icon={KeyRound}>
          How keys work, what each scope allows, and keeping them safe.
        </Card>
        <Card href="/docs/webhooks" title="Webhooks" icon={Webhook}>
          Receive alerts as signed JSON and check they really came from us.
        </Card>
        <Card href="/docs/api" title="API reference" icon={FileText}>
          Every endpoint with its fields and responses, and a console to try them.
        </Card>
      </Cards>

      <H2 id="what-you-can-do">What you can do</H2>
      <Fields
        rows={[
          { name: "Diagnostics", children: <>Ping, TCP ping, port scans, and DNS lookups, answered in one response. <A href="/docs/api#tag/diagnostics">Reference</A></> },
          { name: "Monitors", children: <>Create HTTP, TCP, and ping checks that run on a schedule, and read their uptime. <A href="/docs/api#tag/monitors">Reference</A></> },
          { name: "Alert rules", children: <>Latency and loss thresholds that notify your channels. <A href="/docs/api#tag/alert-rules">Reference</A></> },
          { name: "History", children: <>Every stored probe, filtered and exported as CSV or JSON. <A href="/docs/api#tag/history">Reference</A></> },
          { name: "Infrastructure", children: <>Hosts reported by agents, and network devices over SNMP. <A href="/docs/api#tag/hosts">Reference</A></> },
          { name: "Security", children: <>Passive checks, attack surface, and vulnerabilities for domains you own. <A href="/docs/api#tag/attack-surface">Reference</A></> },
        ]}
      />

      <H2 id="conventions">Conventions</H2>
      <List>
        <li>
          Requests and responses are JSON. Send <C>Content-Type: application/json</C> with a body.
        </li>
        <li>Times are RFC 3339, in UTC.</li>
        <li>
          Errors are a JSON object with one <C>error</C> field and a fitting HTTP status. See <A href="/docs/errors">Errors</A>.
        </li>
        <li>
          Private and cloud-metadata addresses are refused on the hosted service; a <A href="/docs/api#tag/hosts">probe agent</A> reaches
          private networks instead.
        </li>
      </List>
      <P>
        Prefer a machine-readable contract? The full <A href="/openapi.yaml">OpenAPI 3.1 spec</A> works with Postman, code generators, and
        your editor. Alerts can also reach you without code: <A href="/workspace/integrations">connect Slack, Discord, or Telegram</A>{" "}
        in the console.
      </P>
    </Article>
  );
}
