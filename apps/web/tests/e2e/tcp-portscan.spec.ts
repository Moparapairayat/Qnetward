import { expect, test } from "@playwright/test";
import { loginAsDemoUser } from "./helpers/auth";

test("demo user can run TCP ping against the local edge", async ({ page }) => {
  await loginAsDemoUser(page);

  await page.goto("/tcp-ping");
  await page.locator("#probe-target").fill("127.0.0.1");
  await page.locator("#probe-port").fill("8080");
  await page.getByRole("button", { name: /^run$/i }).click();

  await expect(page.getByRole("table").locator("tbody tr").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Run details" })).toBeVisible();
});

test("demo user can run and stop TCP ping in continuous mode", async ({ page }) => {
  await loginAsDemoUser(page);

  await page.goto("/tcp-ping");
  await page.locator("#probe-target").fill("127.0.0.1");
  await page.locator("#probe-port").fill("8080");
  await page.getByRole("button", { name: /options/i }).click();
  await page.locator('input[name="count"]').fill("101");
  await page.getByText("Continuous", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /continuous/i })).toBeChecked();

  await expect(page.locator('input[name="count"]')).toHaveAttribute("readonly", "");

  await page.getByRole("button", { name: /^run$/i }).click();
  await expect(page.getByRole("button", { name: /^stop$/i })).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByRole("table").locator("tbody tr").first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /^stop$/i }).click();
  await expect(page.getByText(/^Stopped$/).first()).toBeVisible({ timeout: 20_000 });
});

test("demo user can run port scan and receive streamed results", async ({ page, baseURL }) => {
  // The web server under test is a port that is open wherever the suite runs.
  const openPort = new URL(baseURL ?? "http://127.0.0.1:3000").port || "80";
  await loginAsDemoUser(page);

  await page.goto("/port-scan");
  await page.locator("#scan-target").fill("127.0.0.1");
  await page.getByRole("button", { name: /^Web$/ }).click();
  await page.locator("#scan-ports").fill(`${openPort},65535`);
  await page.getByRole("button", { name: /^scan$/i }).click();

  await expect(page.getByRole("heading", { name: "Port map" })).toBeVisible({ timeout: 20_000 });

  await page.getByText("Open only", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: /open only/i })).toBeChecked();
  await expect(page.getByRole("table").locator("tbody tr").first()).toBeVisible();
});
