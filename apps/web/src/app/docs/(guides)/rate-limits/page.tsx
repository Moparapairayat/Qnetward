import type { Metadata } from "next";
import { CodeBlock, CodeTabs } from "@/features/docs/docs-code";
import { json } from "@/features/docs/docs-examples";
import { BASE_URL } from "@/features/docs/docs-nav";
import { A, Article, Block, C, Eyebrow, Fields, H2, Lead, P, Title } from "@/features/docs/docs-ui";

export const metadata: Metadata = {
  title: "Rate limits",
  description: "How many API calls each plan allows, and how to back off when you reach the limit.",
};

const toc = [
  { id: "limits", label: "Limits by plan" },
  { id: "over-the-limit", label: "Over the limit" },
  { id: "backing-off", label: "Backing off" },
];

const retryJs = `async function call(path, init = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch("${BASE_URL}" + path, {
      ...init,
      headers: { Authorization: \`Bearer \${process.env.QNETWARD_API_KEY}\`, ...init.headers },
    });
    if (res.status !== 429) return res;
    // Wait as long as the server asks, then try again.
    const seconds = Number(res.headers.get("Retry-After") ?? 1);
    await new Promise((r) => setTimeout(r, seconds * 1000));
  }
  throw new Error("still rate limited after 5 tries");
}`;

const retryPy = `import os
import time
import requests

def call(method, path, **kwargs):
    headers = {"Authorization": f"Bearer {os.environ['QNETWARD_API_KEY']}"}
    for _ in range(5):
        res = requests.request(method, "${BASE_URL}" + path, headers=headers, **kwargs)
        if res.status_code != 429:
            return res
        # Wait as long as the server asks, then try again.
        time.sleep(int(res.headers.get("Retry-After", "1")))
    raise RuntimeError("still rate limited after 5 tries")`;

export default function RateLimits() {
  return (
    <Article toc={toc}>
      <Eyebrow>Essentials</Eyebrow>
      <Title>Rate limits</Title>
      <Lead>Limits keep one busy script from slowing down everyone else&apos;s probes. They&apos;re counted per workspace, not per key.</Lead>

      <H2 id="limits">Limits by plan</H2>
      <P>API calls per minute, for the whole workspace:</P>
      <Fields
        rows={[
          { name: "Free", type: "120 / min", children: <>Enough for dashboards and occasional scripts.</> },
          { name: "Pro", type: "600 / min", children: <>For CI pipelines and tools that poll.</> },
          { name: "Enterprise", type: "3,000 / min", children: <>For heavy automation across many teams.</> },
        ]}
      />
      <P>
        Probes and scans also have hourly quotas, separate from the per-minute limit. You can see your plan&apos;s numbers on the{" "}
        <A href="/upgrade">plans page</A>.
      </P>

      <H2 id="over-the-limit">Over the limit</H2>
      <P>
        Past a limit you get <C>429 Too Many Requests</C> with a <C>Retry-After</C> header: the number of seconds to wait before trying
        again.
      </P>
      <Block>
        <CodeBlock title="Response headers" lang="http" code={`HTTP/1.1 429 Too Many Requests\nRetry-After: 12\nContent-Type: application/json`} />
      </Block>
      <Block>
        <CodeBlock title="Response body" lang="json" code={json({ error: "too many requests, try again later" })} />
      </Block>

      <H2 id="backing-off">Backing off</H2>
      <P>Honour the header rather than guessing. A small wrapper is all it takes:</P>
      <Block>
        <CodeTabs
          examples={[
            { label: "JavaScript", lang: "js", code: retryJs },
            { label: "Python", lang: "python", code: retryPy },
          ]}
        />
      </Block>
    </Article>
  );
}
