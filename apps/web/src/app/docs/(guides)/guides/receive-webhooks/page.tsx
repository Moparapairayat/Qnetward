import type { Metadata } from "next";
import { CodeBlock, CodeTabs } from "@/features/docs/docs-code";
import { A, Article, Block, C, Callout, Eyebrow, H2, Lead, List, P, Step, Steps, Title } from "@/features/docs/docs-ui";

export const metadata: Metadata = {
  title: "Receive webhooks in your app",
  description: "Build an endpoint in Next.js or Express that verifies Qnetward's webhook signature and acts on alerts.",
};

const toc = [
  { id: "steps", label: "Steps" },
  { id: "going-live", label: "Going live" },
];

const nextRoute = `// app/api/qnetward/route.ts
import crypto from "node:crypto";

const SECRET = process.env.QNETWARD_WEBHOOK_SECRET!;

function verify(timestamp: string, signature: string, rawBody: string) {
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const mac = crypto.createHmac("sha256", SECRET).update(\`\${timestamp}.\`).update(rawBody).digest("hex");
  const expected = Buffer.from(\`sha256=\${mac}\`);
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export async function POST(req: Request) {
  // Read the body as text: the signature covers these exact bytes.
  const raw = await req.text();
  const ok = verify(
    req.headers.get("x-qnetward-timestamp") ?? "",
    req.headers.get("x-qnetward-signature") ?? "",
    raw,
  );
  if (!ok) return new Response("bad signature", { status: 401 });

  const event = JSON.parse(raw);
  if (event.event === "monitor.down") {
    await openIncident(event.title, event.url);
  }
  return new Response(null, { status: 204 });
}`;

const express = `import crypto from "node:crypto";
import express from "express";

const app = express();
const SECRET = process.env.QNETWARD_WEBHOOK_SECRET;

// express.raw keeps the body as bytes: the signature covers them exactly.
app.post("/qnetward", express.raw({ type: "application/json" }), (req, res) => {
  const timestamp = req.get("X-Qnetward-Timestamp") ?? "";
  const signature = req.get("X-Qnetward-Signature") ?? "";
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return res.sendStatus(401);

  const mac = crypto.createHmac("sha256", SECRET).update(\`\${timestamp}.\`).update(req.body).digest("hex");
  const expected = Buffer.from(\`sha256=\${mac}\`);
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return res.sendStatus(401);

  const event = JSON.parse(req.body.toString("utf8"));
  console.log(event.event, event.title);
  res.sendStatus(204);
});

app.listen(3000);`;

export default function ReceiveWebhooks() {
  return (
    <Article toc={toc}>
      <Eyebrow>Events</Eyebrow>
      <Title>Receive webhooks in your app</Title>
      <Lead>
        Open an incident, page someone, or post to your own tools whenever Qnetward raises an alert, with a single route in your app.
      </Lead>

      <H2 id="steps">Steps</H2>
      <Steps>
        <Step title="Add the route">
          <P>
            The route reads the raw body, checks the signature and its age, then acts on the event. The two important details: verify
            before parsing, and use the body exactly as it arrived.
          </P>
          <Block>
            <CodeTabs
              examples={[
                { label: "Next.js", lang: "js", code: nextRoute },
                { label: "Express", lang: "js", code: express },
              ]}
            />
          </Block>
        </Step>

        <Step title="Create the channel">
          <P>
            In <A href="/workspace/integrations">Integrations</A>, add a <strong>Webhook</strong> channel with your route&apos;s public
            URL and a long random secret. Put the same secret in <C>QNETWARD_WEBHOOK_SECRET</C>.
          </P>
          <Block>
            <CodeBlock title="A good secret" lang="bash" code="openssl rand -hex 32" />
          </Block>
        </Step>

        <Step title="Send a test">
          <P>
            Press the test button on the channel. Your route should receive a <C>test</C> event and answer <C>204</C>. If it answers{" "}
            <C>401</C>, the secrets don&apos;t match, or a framework parsed the body before you read it.
          </P>
        </Step>
      </Steps>

      <H2 id="going-live">Going live</H2>
      <List>
        <li>Answer within a few seconds; queue slow work instead of doing it in the request.</li>
        <li>The same event can arrive twice. Make what you do safe to repeat.</li>
        <li>
          Route on <C>event</C>, and ignore types you don&apos;t handle. The full list is in <A href="/docs/webhooks#events">Webhooks</A>.
        </li>
      </List>
      <Callout title="Local development">
        Your laptop isn&apos;t reachable from the internet. Use a tunnel such as <C>cloudflared</C> or <C>ngrok</C> to give the route a
        public HTTPS address while you build it.
      </Callout>
    </Article>
  );
}
