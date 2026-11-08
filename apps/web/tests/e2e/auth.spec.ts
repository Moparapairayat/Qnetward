import { expect, test } from "@playwright/test";

test("signup and verify flow reaches the dashboard", async ({ page }) => {
  const nonce = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const email = `signup-${nonce}@example.com`;
  const password = "StrongPass123!";
  const firstName = "Signup";
  const lastName = "Operator";

  await page.goto("/signup");

  await page.getByLabel("Work email").fill(email);
  await page.locator("#signup-password").fill(password);

  const signupResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/auth/signup") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /create account/i }).click();

  const signupResponse = await signupResponsePromise;
  expect(signupResponse.ok()).toBeTruthy();
  const signupPayload = await signupResponse.json();
  expect(signupPayload.preview_code).toBeTruthy();

  await expect(page.getByRole("heading", { name: /check your inbox/i })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();

  // Going back to fix the email and signing up again must work before verifying.
  await page.getByRole("button", { name: /change it/i }).click();
  await page.locator("#signup-password").fill(password);
  const retryPromise = page.waitForResponse((response) =>
    response.url().includes("/api/auth/signup") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /create account/i }).click();
  const retry = await retryPromise;
  expect(retry.ok()).toBeTruthy();
  const retryPayload = await retry.json();

  const verifyResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/auth/verify-email") && response.request().method() === "POST",
  );
  // Pasting the whole code fills every box and submits it.
  await page.locator("#verify-code").focus();
  await page.evaluate((code) => {
    const data = new DataTransfer();
    data.setData("text", code);
    document.querySelector("#verify-code")?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, retryPayload.preview_code);

  const verifyResponse = await verifyResponsePromise;
  expect(verifyResponse.ok()).toBeTruthy();

  await expect(page.getByRole("heading", { name: /set up your workspace/i })).toBeVisible();
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("Last name").fill(lastName);
  await expect(page.locator("#signup-workspace")).toHaveValue(`${firstName}'s workspace`);
  await page.locator("#signup-workspace").fill("Signup Labs");
  await page.getByRole("button", { name: /continue to dashboard/i }).click();

  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Signup Labs").first()).toBeVisible();
});

