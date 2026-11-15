import type { Metadata } from "next";
import { CodeBlock, CodeTabs } from "@/features/docs/docs-code";
import { json, request } from "@/features/docs/docs-examples";
import { A, Article, Block, C, Callout, Endpoint, Eyebrow, Fields, H2, Lead, P, Step, Steps, Title } from "@/features/docs/docs-ui";

export const metadata: Metadata = {
  title: "Monitor an API endpoint",
  description: "Create an uptime monitor for an HTTP endpoint from code, read its status and response times, and run it on demand.",
};

const toc = [
  { id: "before-you-start", label: "Before you start" },
  { id: "steps", label: "Steps" },
  { id: "keeping-it-in-code", label: "Keeping it in code" },
];

export default function MonitorAnEndpoint() {
  return (
    <Article toc={toc}>
      <Eyebrow>Monitoring</Eyebrow>
      <Title>Monitor an API endpoint</Title>
      <Lead>
        Point Qnetward at your health endpoint once, and it checks it every minute from outside your network, even when nobody has the
        console open.
      </Lead>

      <H2 id="before-you-start">Before you start</H2>
      <P>
        You need an API key with the <C>read</C> and <C>write</C> scopes, in <C>QNETWARD_API_KEY</C>. See{" "}
        <A href="/docs/authentication">Authentication</A>.
      </P>

      <H2 id="steps">Steps</H2>
      <Steps>
        <Step title="Create the monitor">
          <P>
            Tell it what to check and how often. With <C>expected_status</C> set, anything else counts as down; without it, any 2xx or
            3xx is up.
          </P>
          <Endpoint method="POST" path="/api/monitors" />
          <Block>
            <CodeTabs
              examples={request("POST", "/api/monitors", {
                name: "Payments API",
                protocol: "http",
                target: "https://api.example.com/health",
                interval_seconds: 60,
                expected_status: 200,
                notify_email: "oncall@example.com",
              })}
            />
          </Block>
          <Fields
            rows={[
              { name: "protocol", type: "string", required: true, children: <><C>http</C> for a URL, <C>tcpping</C> for a port, or <C>ping</C>.</> },
              { name: "target", type: "string", required: true, children: <>A URL for <C>http</C>, otherwise a host name or IP.</> },
              { name: "interval_seconds", type: "integer", required: true, children: <>One of 30, 60, 300, 600, 1800, or 3600, within your plan.</> },
              { name: "expected_status", type: "integer", children: <>The only status that counts as up.</> },
              { name: "notify_email", type: "string", children: <>Emailed when it goes down and when it&apos;s back.</> },
            ]}
          />
        </Step>

        <Step title="Read its status">
          <P>
            Each monitor carries its latest result, 24-hour uptime, and the certificate&apos;s expiry for HTTPS targets.
          </P>
          <Endpoint method="GET" path="/api/monitors" />
          <Block>
            <CodeBlock
              title="One monitor from the list"
              lang="json"
              code={json({
                id: 31,
                name: "Payments API",
                protocol: "http",
                target: "https://api.example.com/health",
                status: "up",
                last_status_code: 200,
                last_rtt_ms: 96.4,
                uptime_24h: 99.93,
                tls_expires_at: "2027-02-01T00:00:00Z",
                next_run_at: "2026-11-14T10:08:00Z",
              })}
            />
          </Block>
        </Step>

        <Step title="Chart its response time">
          <P>
            Ask for a window: <C>15m</C> and <C>1h</C> return every check, <C>6h</C> and <C>24h</C> return averages, so the payload stays
            small.
          </P>
          <Endpoint method="GET" path="/api/monitors/series?window=24h" />
          <Block>
            <CodeTabs examples={request("GET", "/api/monitors/series?window=24h")} />
          </Block>
        </Step>

        <Step title="Run it now">
          <P>
            After a fix, you don&apos;t have to wait for the next interval. The result arrives as a <C>monitor.check</C>{" "}
            <A href="/docs/live-events">live event</A>.
          </P>
          <Endpoint method="POST" path="/api/monitors/run?id=31" />
          <Callout title="Once every ten seconds">A monitor can be run by hand once per ten seconds; sooner than that gets <C>429</C>.</Callout>
        </Step>
      </Steps>

      <H2 id="keeping-it-in-code">Keeping it in code</H2>
      <P>
        Send the same request with the monitor&apos;s <C>id</C> to change it, so a script can own your monitors the way Terraform owns
        infrastructure. Remove one with <C>DELETE /api/monitors?id=31</C>. For alerts in chat as well as email, connect a channel in{" "}
        <A href="/workspace/integrations">Integrations</A>.
      </P>
    </Article>
  );
}
