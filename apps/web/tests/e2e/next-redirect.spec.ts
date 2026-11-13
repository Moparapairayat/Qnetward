import { expect, Page, test } from "@playwright/test";
import { provisionVerifiedUser, resolveOrigin } from "./helpers/auth";

// After signing in, a ?next= link takes the visitor where they were headed,
// such as Pro checkout from the pricing page, but never to another site.

async function signIn(page: Page, path: string, user: { email: string; password: string }) {
  // Wait for hydration: a click before the page is interactive does nothing.
  await page.goto(path, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(user.email);
  await page.locator("#login-password").fill(user.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
}

test("a pricing link goes on to Pro checkout after sign-in", async ({ page, request, baseURL }) => {
  const user = await provisionVerifiedUser(request, resolveOrigin(baseURL));
  await signIn(page, `/login?next=${encodeURIComponent("/upgrade?period=monthly")}`, user);

  await expect(page).toHaveURL(/\/upgrade\?period=monthly$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /^plans$/i })).toBeVisible();
  // The period picked on the pricing page is the one shown.
  await expect(page.getByRole("radio", { name: "Monthly" })).toHaveAttribute("aria-checked", "true");
});

test("next links to other sites are ignored", async ({ page, request, baseURL }) => {
  // Three sign-ins in one test.
  test.setTimeout(120_000);
  const user = await provisionVerifiedUser(request, resolveOrigin(baseURL));
  for (const evil of ["https://evil.example/", "//evil.example/", "/\\evil.example"]) {
    await page.context().clearCookies();
    await signIn(page, `/login?next=${encodeURIComponent(evil)}`, user);
    await expect(page).toHaveURL(/\/overview$/, { timeout: 20_000 });
  }
});

test("opening a console page while signed out comes back to it", async ({ page, request, baseURL }) => {
  const user = await provisionVerifiedUser(request, resolveOrigin(baseURL));
  await page.goto("/monitors");
  await expect(page).toHaveURL(/\/login\?next=%2Fmonitors$/, { timeout: 20_000 });
  await signIn(page, page.url().replace(/^https?:\/\/[^/]+/, ""), user);
  await expect(page).toHaveURL(/\/monitors$/, { timeout: 20_000 });
});
