import type { Metadata } from "next";
import { CodeBlock } from "@/features/docs/docs-code";
import { json } from "@/features/docs/docs-examples";
import { A, Article, Block, C, Eyebrow, Fields, H2, Lead, List, P, Title } from "@/features/docs/docs-ui";

export const metadata: Metadata = {
  title: "Errors",
  description: "How Qnetward reports errors, what each status means, and which ones to retry.",
};

const toc = [
  { id: "shape", label: "The shape of an error" },
  { id: "status-codes", label: "Status codes" },
  { id: "retrying", label: "What to retry" },
];

export default function Errors() {
  return (
    <Article toc={toc}>
      <Eyebrow>Essentials</Eyebrow>
      <Title>Errors</Title>
      <Lead>When a request fails, the status code says what kind of problem it is, and the body says what exactly went wrong, in words.</Lead>

      <H2 id="shape">The shape of an error</H2>
      <P>
        Every error is a JSON object with one field, <C>error</C>. It&apos;s written to be read by a person, so it&apos;s fine to show it
        in your own tools as it is.
      </P>
      <Block>
        <CodeBlock title="Response" status="409 Conflict" lang="json" code={json({ error: "this plan's network device limit is reached" })} />
      </Block>

      <H2 id="status-codes">Status codes</H2>
      <Fields
        rows={[
          { name: "400", type: "Bad Request", children: <>The body is malformed or a value is out of range, such as a port above 65535.</> },
          { name: "401", type: "Unauthorized", children: <>No API key, or the key is wrong, revoked, or expired. See <A href="/docs/authentication">Authentication</A>.</> },
          { name: "403", type: "Forbidden", children: <>The key lacks the scope this request needs, or your role can&apos;t make this change.</> },
          { name: "404", type: "Not Found", children: <>Nothing with that id in this workspace.</> },
          { name: "409", type: "Conflict", children: <>A plan limit is reached, or the change conflicts with the current state.</> },
          { name: "429", type: "Too Many Requests", children: <>Over a rate limit or quota. Wait the <C>Retry-After</C> seconds. See <A href="/docs/rate-limits">Rate limits</A>.</> },
        ]}
      />

      <H2 id="retrying">What to retry</H2>
      <List>
        <li>
          <C>429</C>: always, after the <C>Retry-After</C> delay.
        </li>
        <li>
          <C>5xx</C> and network failures: yes, a few times, waiting longer each time.
        </li>
        <li>
          <C>400</C>, <C>401</C>, <C>403</C>, <C>404</C>, and <C>409</C>: no. The same request will fail the same way until something
          changes, so fix the request or the key first.
        </li>
      </List>
    </Article>
  );
}
