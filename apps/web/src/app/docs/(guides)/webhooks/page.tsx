import type { Metadata } from "next";
import { CodeBlock, CodeTabs } from "@/features/docs/docs-code";
import { json } from "@/features/docs/docs-examples";
import { A, Article, Block, C, Callout, Eyebrow, Fields, H2, Lead, List, P, Title } from "@/features/docs/docs-ui";

export const metadata: Metadata = {
  title: "Webhooks",
  description: "Receive Qnetward alerts as signed JSON, and verify the signature before you trust them.",
};

const toc = [
  { id: "setting-up", label: "Setting up" },
  { id: "payload", label: "The payload" },
  { id: "events", label: "Events" },
  { id: "verifying", label: "Verifying signatures" },
  { id: "responding", label: "Responding" },
];

const verifyJs = `import crypto from "node:crypto";

// rawBody is the request body exactly as it arrived, before any JSON parsing.
export function verify(secret, headers, rawBody) {
  const timestamp = headers["x-qnetward-timestamp"];
  const signature = headers["x-qnetward-signature"] ?? "";

  // Refuse anything older than five minutes, so a captured request can't be replayed.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const mac = crypto.createHmac("sha256", secret).update(\`\${timestamp}.\`).update(rawBody).digest("hex");
  const expected = Buffer.from(\`sha256=\${mac}\`);
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}`;

const verifyPy = `import hashlib
import hmac
import time

# raw_body is the request body exactly as it arrived, as bytes.
def verify(secret: str, headers, raw_body: bytes) -> bool:
    timestamp = headers["X-Qnetward-Timestamp"]
    signature = headers.get("X-Qnetward-Signature", "")

    # Refuse anything older than five minutes, so a captured request can't be replayed.
    if abs(time.time() - int(timestamp)) > 300:
        return False

    mac = hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={mac}", signature)`;

const verifyGo = `func verify(secret string, r *http.Request, rawBody []byte) bool {
	timestamp := r.Header.Get("X-Qnetward-Timestamp")
	signature := r.Header.Get("X-Qnetward-Signature")

	// Refuse anything older than five minutes, so a captured request can't be replayed.
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || math.Abs(float64(time.Now().Unix()-ts)) > 300 {
		return false
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(rawBody)
	expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}`;

export default function Webhooks() {
  return (
    <Article toc={toc}>
      <Eyebrow>Events</Eyebrow>
      <Title>Webhooks</Title>
      <Lead>
        When a monitor goes down, an alert rule fires, or a host crosses a threshold, Qnetward can <C>POST</C> the news to your own
        endpoint, signed so you know it&apos;s really from us.
      </Lead>

      <H2 id="setting-up">Setting up</H2>
      <P>
        In the console, open <A href="/workspace/integrations">Integrations</A>, add a channel of the <strong>Webhook</strong> kind, and
        give it your URL and a secret. Use the test button to send a <C>test</C> event and see it arrive.
      </P>

      <H2 id="payload">The payload</H2>
      <P>Every delivery is a JSON body with the same fields, whatever happened:</P>
      <Block>
        <CodeBlock
          title="POST to your endpoint"
          lang="json"
          code={json({
            event: "monitor.down",
            severity: "critical",
            title: "api.example.com is down",
            summary: "HTTPS returned 502 from every location.",
            target: "https://api.example.com/health",
            url: "https://console.qnetward.com/monitors",
            triggered_at: "2026-11-14T10:07:00Z",
          })}
        />
      </Block>
      <Fields
        rows={[
          { name: "event", type: "string", children: <>What happened. See <A href="#events">Events</A>.</> },
          { name: "severity", type: "string", children: <><C>critical</C>, <C>warning</C>, <C>success</C>, or <C>info</C>.</> },
          { name: "title", type: "string", children: <>One line, written for a person.</> },
          { name: "summary", type: "string", children: <>A sentence or two with the details.</> },
          { name: "target", type: "string", children: <>What it&apos;s about, when there is one.</> },
          { name: "url", type: "string", children: <>Where to look in the console.</> },
          { name: "triggered_at", type: "string", children: <>When it happened, RFC 3339 in UTC.</> },
        ]}
      />
      <P>Each request also carries three headers:</P>
      <Fields
        rows={[
          { name: "X-Qnetward-Event", children: <>The same value as <C>event</C>, so you can route before parsing.</> },
          { name: "X-Qnetward-Timestamp", children: <>Unix seconds when we sent it.</> },
          { name: "X-Qnetward-Signature", children: <>Present when the channel has a secret: <C>sha256=</C> and a hex HMAC.</> },
        ]}
      />

      <H2 id="events">Events</H2>
      <Fields
        rows={[
          { name: "monitor.down", children: <>A monitor failed its checks.</> },
          { name: "monitor.up", children: <>It&apos;s answering again.</> },
          { name: "alert.firing", children: <>An alert rule&apos;s threshold was crossed.</> },
          { name: "alert.resolved", children: <>Back within the threshold.</> },
          { name: "host.alert", children: <>A host crossed a CPU, memory, disk, or offline threshold.</> },
          { name: "host.recovered", children: <>The host is back to normal.</> },
          { name: "test", children: <>Sent from the test button.</> },
        ]}
      />
      <P>New events may be added. Ignore the ones you don&apos;t handle rather than treating them as errors.</P>

      <H2 id="verifying">Verifying signatures</H2>
      <P>
        The signature is the HMAC-SHA256, keyed with the channel&apos;s secret, of the timestamp, a dot, and the raw body. Compute it
        yourself and compare in constant time. Use the body as it arrived: parsing and re-encoding the JSON changes the bytes.
      </P>
      <Block>
        <CodeTabs
          examples={[
            { label: "JavaScript", lang: "js", code: verifyJs },
            { label: "Python", lang: "python", code: verifyPy },
            { label: "Go", lang: "go", code: verifyGo },
          ]}
        />
      </Block>
      <Callout tone="warn" title="Always check the timestamp">
        A valid signature on an old request still means someone replayed it. Refuse anything more than five minutes off your clock.
      </Callout>

      <H2 id="responding">Responding</H2>
      <List>
        <li>Answer with any 2xx quickly, and do slow work afterwards.</li>
        <li>Make your handler safe to run twice for the same event.</li>
        <li>
          Use HTTPS. Endpoints on private addresses are refused on the hosted service.
        </li>
      </List>
    </Article>
  );
}
