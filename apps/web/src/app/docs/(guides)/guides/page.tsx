import type { Metadata } from "next";
import { Activity, Radio, Webhook } from "@/components/icons";
import { A, Article, Card, Cards, Eyebrow, H2, Lead, P, Title } from "@/features/docs/docs-ui";

export const metadata: Metadata = {
  title: "Guides",
  description: "Step-by-step guides for common jobs with the Qnetward API: monitoring an endpoint, checking deploys from CI, receiving webhooks, and live status boards.",
};

const toc = [
  { id: "monitoring", label: "Monitoring" },
  { id: "events", label: "Events" },
];

export default function GuidesHome() {
  return (
    <Article toc={toc}>
      <Eyebrow>Guides</Eyebrow>
      <Title>Guides</Title>
      <Lead>
        Each guide does one real job from start to finish, with code you can paste. If you haven&apos;t made a request yet, start with
        the <A href="/docs/quickstart">Quickstart</A>.
      </Lead>

      <H2 id="monitoring">Monitoring</H2>
      <Cards>
        <Card href="/docs/guides/monitor-an-endpoint" title="Monitor an API endpoint" icon={Radio}>
          Create a health check from code, read its uptime and response times, and run it on demand.
        </Card>
        <Card href="/docs/guides/probes-in-ci" title="Check a deploy from CI" icon={Activity}>
          After each deploy, probe the new service from outside and fail the pipeline if it isn&apos;t answering.
        </Card>
      </Cards>

      <H2 id="events">Events</H2>
      <Cards>
        <Card href="/docs/guides/receive-webhooks" title="Receive webhooks in your app" icon={Webhook}>
          An endpoint in Next.js or Express that checks the signature and acts on alerts.
        </Card>
        <Card href="/docs/guides/live-dashboard" title="Build a live status board" icon={Activity}>
          Keep a small server in sync with the live event stream and show it to your team.
        </Card>
      </Cards>
      <P>
        Missing a guide you need? Tell us on <A href="https://github.com/Quantum-Axis/Qnetward/issues">GitHub</A>.
      </P>
    </Article>
  );
}
