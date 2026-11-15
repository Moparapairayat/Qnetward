import type { Metadata } from "next";
import { CodeBlock, CodeTabs } from "@/features/docs/docs-code";
import { BASE_URL } from "@/features/docs/docs-nav";
import { A, Article, Block, C, Callout, Endpoint, Eyebrow, Fields, H2, Lead, P, Title } from "@/features/docs/docs-ui";

export const metadata: Metadata = {
  title: "Live events",
  description: "Stream every change and alert in a workspace as Server-Sent Events, and pick up where you left off after a drop.",
};

const toc = [
  { id: "connecting", label: "Connecting" },
  { id: "the-stream", label: "The stream" },
  { id: "event-types", label: "Event types" },
  { id: "reconnecting", label: "Reconnecting" },
];

const curl = `curl -N ${BASE_URL}/api/events \\
  -H "Authorization: Bearer $QNETWARD_API_KEY"`;

const node = `// Node 18+: read the stream with fetch, one event per blank-line-separated block.
const res = await fetch("${BASE_URL}/api/events", {
  headers: { Authorization: \`Bearer \${process.env.QNETWARD_API_KEY}\` },
});

const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of res.body) {
  buffer += decoder.decode(chunk, { stream: true });
  let end;
  while ((end = buffer.indexOf("\\n\\n")) !== -1) {
    const block = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    const data = block.split("\\n").find((l) => l.startsWith("data: "));
    if (data) console.log(JSON.parse(data.slice(6)));
  }
}`;

const python = `import json
import os
import requests

res = requests.get(
    "${BASE_URL}/api/events",
    headers={"Authorization": f"Bearer {os.environ['QNETWARD_API_KEY']}"},
    stream=True,
)
for line in res.iter_lines(decode_unicode=True):
    if line and line.startswith("data: "):
        print(json.loads(line[6:]))`;

const frames = `retry: 3000

event: ready
data: {"type":"ready","at":1763114520000}

id: 4812
event: monitor.check
data: {"id":4812,"type":"monitor.check","monitor_id":12,"status":"down","at":1763114581000}

id: 4813
event: alert.changed
data: {"id":4813,"type":"alert.changed","at":1763114582000}`;

export default function LiveEvents() {
  return (
    <Article toc={toc}>
      <Eyebrow>Events</Eyebrow>
      <Title>Live events</Title>
      <Lead>
        One long-lived request tells you about every check, alert, and change in the workspace the moment it happens. It&apos;s the same
        stream the console uses to stay live.
      </Lead>

      <H2 id="connecting">Connecting</H2>
      <P>
        Open the stream with your API key. It&apos;s plain{" "}
        <A href="https://developer.mozilla.org/docs/Web/API/Server-sent_events">Server-Sent Events</A> over HTTP, so any SSE client works.
      </P>
      <Endpoint method="GET" path="/api/events" />
      <Block>
        <CodeTabs
          examples={[
            { label: "curl", lang: "bash", code: curl },
            { label: "JavaScript", lang: "js", code: node },
            { label: "Python", lang: "python", code: python },
          ]}
        />
      </Block>

      <H2 id="the-stream">The stream</H2>
      <P>
        The first message is always <C>ready</C>. After that, each event names what changed, and carries small values such as a
        monitor&apos;s new status. For anything larger, fetch the details through the usual endpoints.
      </P>
      <Block>
        <CodeBlock title="What arrives" lang="bash" code={frames} />
      </Block>
      <Fields
        rows={[
          { name: "id", type: "integer", children: <>Where this event sits in the stream. Keep the last one you saw.</> },
          { name: "type", type: "string", children: <>What changed. Also sent as the SSE <C>event</C> name.</> },
          { name: "monitor_id", type: "integer", children: <>For monitor events, which monitor.</> },
          { name: "status", type: "string", children: <>For monitor checks, <C>up</C> or <C>down</C>.</> },
          { name: "at", type: "integer", children: <>When it happened, in Unix milliseconds.</> },
        ]}
      />

      <H2 id="event-types">Event types</H2>
      <Fields
        rows={[
          { name: "ready", children: <>Sent first on every connection.</> },
          { name: "monitor.check", children: <>A monitor ran a check.</> },
          { name: "monitor.changed", children: <>Someone created, changed, or deleted a monitor.</> },
          { name: "alert.changed", children: <>An alert rule changed, fired, or resolved.</> },
          { name: "host.changed", children: <>A host or one of its alerts changed.</> },
          { name: "agent.changed", children: <>A probe agent was added, removed, or changed state.</> },
          { name: "device.changed", children: <>A network device changed.</> },
          { name: "security.scan", children: <>A security scan finished.</> },
          { name: "resync", children: <>You missed too much to replay: refetch what you show.</> },
        ]}
      />
      <P>Types may be added over time. Skip the ones you don&apos;t know.</P>

      <H2 id="reconnecting">Reconnecting</H2>
      <P>
        Connections drop, so plan for it. Reconnect with the last <C>id</C> you received in a <C>Last-Event-ID</C> header and you get
        what you missed, in order. Most SSE clients do this for you, waiting the <C>retry</C> interval the server sends first.
      </P>
      <Callout title="Too far behind">
        If too much happened while you were away, you get a single <C>resync</C> instead of the backlog. Refetch the data you show from
        the <A href="/docs/api">API</A> and carry on from there.
      </Callout>
    </Article>
  );
}
