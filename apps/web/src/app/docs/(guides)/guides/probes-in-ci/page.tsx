import type { Metadata } from "next";
import { CodeBlock } from "@/features/docs/docs-code";
import { BASE_URL } from "@/features/docs/docs-nav";
import { A, Article, Block, C, Callout, Eyebrow, H2, Lead, List, P, Title } from "@/features/docs/docs-ui";

export const metadata: Metadata = {
  title: "Check a deploy from CI",
  description: "After a deploy, probe the service from outside your network and fail the pipeline if it isn't answering.",
};

const toc = [
  { id: "the-idea", label: "The idea" },
  { id: "the-check", label: "The check" },
  { id: "github-actions", label: "GitHub Actions" },
  { id: "tuning", label: "Tuning" },
];

const script = `#!/usr/bin/env bash
# check-deploy.sh HOST PORT: fail if the service isn't reachable from outside.
set -euo pipefail

host="$1"
port="$2"

report=$(curl -sS --fail-with-body -X POST ${BASE_URL}/api/tcpping \\
  -H "Authorization: Bearer $QNETWARD_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "{\\"host\\": \\"$host\\", \\"port\\": $port, \\"count\\": 5}")

loss=$(echo "$report" | jq '.summary.loss')
avg=$(echo "$report" | jq -r '.summary.avg // "n/a"')
echo "$host:$port  loss=$loss%  avg=$avg"

# Any lost handshake fails the build.
if [ "$(echo "$loss > 0" | bc)" -eq 1 ]; then
  echo "::error::$host:$port lost $loss% of handshakes"
  exit 1
fi`;

const workflow = `name: deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy
        run: ./deploy.sh

      - name: Check it from outside
        env:
          QNETWARD_API_KEY: \${{ secrets.QNETWARD_API_KEY }}
        run: ./check-deploy.sh api.example.com 443`;

export default function ProbesInCi() {
  return (
    <Article toc={toc}>
      <Eyebrow>Monitoring</Eyebrow>
      <Title>Check a deploy from CI</Title>
      <Lead>
        A green pipeline only says the deploy finished. Probing the service from outside your network says people can actually reach it.
      </Lead>

      <H2 id="the-idea">The idea</H2>
      <P>
        Right after the deploy step, ask Qnetward to open a few TCP connections to the service&apos;s public port. If any handshake fails,
        fail the job, before your users notice.
      </P>
      <P>
        Create a key with only the <C>probe</C> scope for this. It can run checks but can&apos;t change anything in your workspace.
      </P>

      <H2 id="the-check">The check</H2>
      <P>
        A short script calls <A href="/docs/api#tag/diagnostics">TCP ping</A>, prints the result, and exits non-zero on loss. It needs{" "}
        <C>curl</C>, <C>jq</C>, and <C>bc</C>, which CI images usually have.
      </P>
      <Block>
        <CodeBlock title="check-deploy.sh" lang="bash" code={script} />
      </Block>

      <H2 id="github-actions">GitHub Actions</H2>
      <P>
        Store the key as a repository secret named <C>QNETWARD_API_KEY</C>, then run the script after deploying. Other CI systems work
        the same way: one step, one secret.
      </P>
      <Block>
        <CodeBlock title=".github/workflows/deploy.yml" lang="bash" code={workflow} />
      </Block>

      <H2 id="tuning">Tuning</H2>
      <List>
        <li>
          Services can take a few seconds to come up. Retry the check two or three times with a short sleep before failing.
        </li>
        <li>
          Check latency too: <C>.summary.avg</C> is a duration such as <C>&quot;42.1ms&quot;</C>, and each reply&apos;s{" "}
          <C>rtt_ms</C> is a number you can compare.
        </li>
        <li>Probes count toward your plan&apos;s hourly quota, so check once per deploy rather than in a tight loop.</li>
      </List>
      <Callout title="Private services">
        The hosted service refuses private addresses. For internal services, run the same check through a{" "}
        <A href="/docs/api#tag/hosts">probe agent</A> inside your network.
      </Callout>
    </Article>
  );
}
