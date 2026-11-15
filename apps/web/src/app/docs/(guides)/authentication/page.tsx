import type { Metadata } from "next";
import { CodeBlock, CodeTabs } from "@/features/docs/docs-code";
import { json, request } from "@/features/docs/docs-examples";
import { A, Article, Block, C, Callout, Eyebrow, Fields, H2, Lead, List, P, Title } from "@/features/docs/docs-ui";

export const metadata: Metadata = {
  title: "Authentication",
  description: "Authenticate with a workspace API key, choose its scopes, and keep it safe.",
};

const toc = [
  { id: "api-keys", label: "API keys" },
  { id: "sending-the-key", label: "Sending the key" },
  { id: "scopes", label: "Scopes" },
  { id: "failures", label: "When it fails" },
  { id: "keeping-keys-safe", label: "Keeping keys safe" },
];

export default function Authentication() {
  return (
    <Article toc={toc}>
      <Eyebrow>Essentials</Eyebrow>
      <Title>Authentication</Title>
      <Lead>Every request carries a workspace API key. The key decides which workspace you act in and what you&apos;re allowed to do there.</Lead>

      <H2 id="api-keys">API keys</H2>
      <P>
        Owners and admins create keys under <A href="/workspace/api-keys">Workspace settings → API keys</A>. A key begins with{" "}
        <C>qnw_</C>, belongs to one workspace, and acts there with the scopes you chose. You can give it an expiry date, and revoke it at
        any time; a revoked or expired key stops working on the next request.
      </P>
      <Callout title="Shown once">
        The full key appears only when you create it. We store a hash, so if it&apos;s lost, revoke it and make a new one.
      </Callout>

      <H2 id="sending-the-key">Sending the key</H2>
      <P>
        Send it as a bearer token in the <C>Authorization</C> header, on every request. There are no sessions or cookies to manage.
      </P>
      <Block>
        <CodeTabs examples={request("GET", "/api/monitors")} />
      </Block>

      <H2 id="scopes">Scopes</H2>
      <P>Give each key only what its job needs. A dashboard that reads uptime has no reason to start scans.</P>
      <Fields
        rows={[
          { name: "read", children: <>Every <C>GET</C>, and history export.</> },
          { name: "write", children: <>Creating, changing, and deleting monitors, alert rules, watches, and devices.</> },
          { name: "probe", children: <>Running ping, TCP ping, port scans, DNS lookups, and scans.</> },
        ]}
      />

      <H2 id="failures">When it fails</H2>
      <P>
        A missing, wrong, or revoked key gets <C>401</C>. A good key without the scope a request needs, or a role that can&apos;t make the
        change, gets <C>403</C>, with a message that names what&apos;s missing.
      </P>
      <Block>
        <CodeBlock title="Response" status="403 Forbidden" lang="json" code={json({ error: "this API key does not have the write scope" })} />
      </Block>

      <H2 id="keeping-keys-safe">Keeping keys safe</H2>
      <List>
        <li>Keep keys in environment variables or your CI&apos;s secret store, never in code or in a browser.</li>
        <li>Use one key per script or service, named after it, so revoking one breaks nothing else.</li>
        <li>Set an expiry for keys that are only needed for a while.</li>
        <li>
          Every create and revoke is written to the workspace&apos;s <A href="/workspace/audit-log">audit log</A>.
        </li>
      </List>
    </Article>
  );
}
