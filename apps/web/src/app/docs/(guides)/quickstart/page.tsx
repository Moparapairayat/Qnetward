import type { Metadata } from "next";
import { CodeBlock, CodeTabs } from "@/features/docs/docs-code";
import { json, request } from "@/features/docs/docs-examples";
import { A, Article, Block, C, Callout, Endpoint, Eyebrow, H2, Lead, P, Step, Steps, Title } from "@/features/docs/docs-ui";

export const metadata: Metadata = {
  title: "Quickstart",
  description: "Create an API key, make your first request, run a probe, and create a monitor from code.",
};

const toc = [
  { id: "steps", label: "Steps" },
  { id: "next", label: "Where to go next" },
];

export default function Quickstart() {
  return (
    <Article toc={toc}>
      <Eyebrow>Get started</Eyebrow>
      <Title>Quickstart</Title>
      <Lead>Five minutes from nothing to a monitor created by your own code. You need a Qnetward workspace where you&apos;re an owner or an admin.</Lead>

      <H2 id="steps">Steps</H2>
      <Steps>
        <Step title="Create an API key">
          <P>
            In the console, open <A href="/workspace/api-keys">Workspace settings → API keys</A> and create a key. Give it the{" "}
            <C>read</C>, <C>write</C>, and <C>probe</C> scopes for this guide. The key is shown once, so copy it straight into your
            environment:
          </P>
          <Block>
            <CodeBlock code={`export QNETWARD_API_KEY="qnw_…"`} lang="bash" title="Terminal" />
          </Block>
        </Step>

        <Step title="Make your first request">
          <P>List the workspace&apos;s monitors. An empty list is a perfectly good answer on a new workspace.</P>
          <Endpoint method="GET" path="/api/monitors" />
          <Block>
            <CodeTabs examples={request("GET", "/api/monitors")} />
          </Block>
          <Block>
            <CodeBlock
              title="Response"
              status="200 OK"
              lang="json"
              code={json([
                {
                  id: 12,
                  name: "Website",
                  protocol: "http",
                  target: "https://example.com/",
                  interval_seconds: 60,
                  enabled: true,
                  status: "up",
                  last_rtt_ms: 84.2,
                  last_status_code: 200,
                  uptime_24h: 100,
                  last_checked_at: "2026-11-14T10:02:00Z",
                },
              ])}
            />
          </Block>
        </Step>

        <Step title="Run a probe">
          <P>
            Ping a host three times. The answer arrives when the run ends, with every reply and a summary; the samples are also kept
            in history.
          </P>
          <Endpoint method="POST" path="/api/ping" />
          <Block>
            <CodeTabs examples={request("POST", "/api/ping", { host: "1.1.1.1", count: 3 })} />
          </Block>
          <Block>
            <CodeBlock
              title="Response"
              status="200 OK"
              lang="json"
              code={json({
                protocol: "icmp",
                target: "1.1.1.1",
                addr: "1.1.1.1",
                results: [
                  { seq: 1, rtt: "18.2ms", rtt_ms: 18.2, addr: "1.1.1.1" },
                  { seq: 2, rtt: "17.9ms", rtt_ms: 17.9, addr: "1.1.1.1" },
                  { seq: 3, rtt: "19.4ms", rtt_ms: 19.4, addr: "1.1.1.1" },
                ],
                summary: { sent: 3, recv: 3, loss: 0, min: "17.9ms", avg: "18.5ms", max: "19.4ms", jitter: "0.9ms" },
              })}
            />
          </Block>
        </Step>

        <Step title="Create a monitor">
          <P>
            Turn a URL into a check that runs every minute, even with no one watching. Send <C>id</C> with the same request later to
            change it.
          </P>
          <Endpoint method="POST" path="/api/monitors" />
          <Block>
            <CodeTabs
              examples={request("POST", "/api/monitors", {
                name: "API health",
                protocol: "http",
                target: "https://api.example.com/health",
                interval_seconds: 60,
                expected_status: 200,
              })}
            />
          </Block>
          <Callout title="Plan limits apply">
            Each plan allows a number of monitors and a shortest interval. Past either, you get <C>409</C> with a message saying which.
          </Callout>
        </Step>
      </Steps>

      <H2 id="next">Where to go next</H2>
      <P>
        Read how <A href="/docs/authentication">scopes</A> keep a key to what it needs, get alerts as signed{" "}
        <A href="/docs/webhooks">webhooks</A>, or follow every change with <A href="/docs/live-events">live events</A>. Every endpoint is in
        the <A href="/docs/api">API reference</A>.
      </P>
    </Article>
  );
}
