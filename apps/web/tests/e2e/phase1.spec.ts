import { expect, test } from "@playwright/test";
import { loginAsVerifiedUser, resolveOrigin } from "./helpers/auth";

// The Phase 1 workspace features, end to end: a scheduled monitor that the
// server checks on its own, an API key that can read it, and audit entries
// for both.
test("owner can add a monitor, create an API key, and see both in the audit log", async ({ page, request, baseURL }) => {
  const origin = resolveOrigin(baseURL);
  await loginAsVerifiedUser(page, request, origin);

  // The web server itself is a TCP port the e2e backend can reach.
  const port = new URL(origin).port || "80";
  const target = `127.0.0.1:${port}`;

  await page.goto("/monitors");
  await page.getByRole("radio", { name: "TCP connect" }).click();
  await page.locator("#monitor-target").fill("127.0.0.1");
  await page.locator("#monitor-port").fill(port);
  await page.getByRole("radio", { name: "1 min" }).click();
  await page.locator("#monitor-email").fill("");
  await page.getByRole("button", { name: "Create monitor" }).click();
  await expect(page.getByRole("heading", { name: target })).toBeVisible();

  // The runner claims new monitors within seconds; the list refreshes on reload.
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("listitem").filter({ hasText: target }).getByText("Up", { exact: true })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  await page.goto("/workspace/api-keys");
  await page.getByPlaceholder("GitHub Actions deploy checks").fill("e2e reader");
  await page.getByRole("button", { name: "Create key" }).click();
  // The full token, not the short prefix shown in the key list.
  const token = (await page.locator("code").filter({ hasText: /^qnw_[A-Za-z0-9_-]{40,}$/ }).innerText()).trim();
  expect(token).toMatch(/^qnw_[A-Za-z0-9_-]{40,}$/);

  const listed = await request.get("/api/monitors", { headers: { Authorization: `Bearer ${token}` } });
  expect(listed.ok()).toBeTruthy();
  expect(JSON.stringify(await listed.json())).toContain("127.0.0.1");
  const denied = await request.post("/api/monitors", {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: { protocol: "ping", target: "example.com", interval_seconds: 300 },
  });
  expect(denied.status()).toBe(403);

  await page.goto("/workspace/audit-log");
  await expect(page.getByText(`created monitor ${target}`)).toBeVisible();
  await expect(page.getByText("created API key e2e reader")).toBeVisible();
});
