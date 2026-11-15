import type { Metadata } from "next";
import { CodeBlock } from "@/features/docs/docs-code";
import { BASE_URL } from "@/features/docs/docs-nav";
import { A, Article, Block, C, Callout, Eyebrow, H2, Lead, List, P, Title } from "@/features/docs/docs-ui";

export const metadata: Metadata = {
  title: "Build a live status board",
  description: "Keep a small server in sync with Qnetward's live event stream and show your monitors' status to your team.",
};

const toc = [
  { id: "how-it-fits", label: "How it fits together" },
  { id: "the-server", label: "The server" },
  { id: "the-page", label: "The page" },
  { id: "next", label: "Making it yours" },
];

const server = `// board.mjs: node board.mjs, then open http://localhost:8080
import http from "node:http";

const API = "${BASE_URL}";
const KEY = process.env.QNETWARD_API_KEY; // read scope only
const headers = { Authorization: \`Bearer \${KEY}\` };

let monitors = [];
let lastId = "";

async function refresh() {
  const res = await fetch(\`\${API}/api/monitors\`, { headers });
  monitors = await res.json();
}

// Follow the live stream; reconnect with the last id after a drop.
async function follow() {
  for (;;) {
    try {
      const res = await fetch(\`\${API}/api/events\`, {
        headers: { ...headers, ...(lastId ? { "Last-Event-ID": lastId } : {}) },
      });
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf("\\n\\n")) !== -1) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const id = block.match(/^id: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (id) lastId = id;
          if (!data) continue;
          const event = JSON.parse(data);
          // Anything about monitors, or a resync: fetch the list again.
          if (event.type.startsWith("monitor.") || event.type === "resync") await refresh();
        }
      }
    } catch (err) {
      console.error("stream dropped:", err.message);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

http
  .createServer((req, res) => {
    if (req.url === "/status.json") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(monitors.map(({ name, status, uptime_24h }) => ({ name, status, uptime_24h }))));
    }
    res.setHeader("Content-Type", "text/html");
    res.end(page);
  })
  .listen(8080);

await refresh();
follow();`;

const page = `const page = \`<!doctype html>
<title>Status</title>
<style>
  body { font: 15px system-ui; background: #0b0b0e; color: #ededf0; padding: 40px; }
  li { list-style: none; padding: 10px 0; border-bottom: 1px solid #222; display: flex; gap: 12px; }
  .up { color: #4ade80 } .down { color: #f87171 } .pending { color: #a1a1aa }
</style>
<ul id="list"></ul>
<script>
  async function draw() {
    const items = await (await fetch("/status.json")).json();
    list.innerHTML = items
      .map((m) => \\\`<li><b class="\\\${m.status}">●</b>\\\${m.name}<span style="margin-left:auto">\\\${m.uptime_24h ?? "–"}%</span></li>\\\`)
      .join("");
  }
  draw();
  setInterval(draw, 5000);
</script>\`;`;

export default function LiveDashboard() {
  return (
    <Article toc={toc}>
      <Eyebrow>Events</Eyebrow>
      <Title>Build a live status board</Title>
      <Lead>
        A screen on the office wall, or a page in your own tools, that shows which monitors are up, and changes the moment one goes down.
      </Lead>

      <H2 id="how-it-fits">How it fits together</H2>
      <List>
        <li>
          A small Node server holds a <C>read</C>-only key. It loads the monitors once, then follows the{" "}
          <A href="/docs/live-events">live event stream</A>.
        </li>
        <li>When a monitor event arrives, it fetches the list again, so it always has the latest status.</li>
        <li>Your page talks only to that server. The API key never reaches a browser.</li>
      </List>

      <H2 id="the-server">The server</H2>
      <P>
        No dependencies, Node 18 or later. It reconnects on its own and sends <C>Last-Event-ID</C> so nothing is missed.
      </P>
      <Block>
        <CodeBlock title="board.mjs" lang="js" code={server} />
      </Block>

      <H2 id="the-page">The page</H2>
      <P>Add the page above the server code. It reads the server&apos;s small JSON and redraws every few seconds.</P>
      <Block>
        <CodeBlock title="board.mjs (top of the file)" lang="js" code={page} />
      </Block>
      <Callout title="Keep the key on the server">
        Browsers can show anyone the requests a page makes. The board only ever sees names and statuses, never the key.
      </Callout>

      <H2 id="next">Making it yours</H2>
      <List>
        <li>
          Add response times from <C>GET /api/monitors/series</C> for a small chart beside each monitor.
        </li>
        <li>
          Prefer a public page with no code? <A href="/docs/api#tag/status-pages">Status pages</A> are built in.
        </li>
      </List>
    </Article>
  );
}
