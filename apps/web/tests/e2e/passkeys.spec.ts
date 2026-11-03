import { expect, test } from "@playwright/test";
import { loginAsVerifiedUser, resolveOrigin } from "./helpers/auth";

// A full passkey round trip with Chrome's virtual authenticator: add one in
// settings, sign out, and sign back in with it and no password.
test("user can add a passkey and sign in with it", async ({ page, request, baseURL }) => {
  const origin = resolveOrigin(baseURL);
  const providers = await (await request.get("/api/auth/providers")).json();
  test.skip(!providers.passkeys, "passkeys need the suite on a domain name such as localhost");

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  const user = await loginAsVerifiedUser(page, request, origin);
  await page.goto("/settings/security");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await page.locator("#passkeys input[type=password]").fill(user.password);
  await page.getByRole("button", { name: "Create passkey" }).click();
  await expect(page.locator("#passkeys li").first()).toContainText("passkey");

  await page.context().clearCookies();
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/\/overview$/, { timeout: 15_000 });

  await page.goto("/settings/security");
  await expect(page.locator("#activity")).toContainText("Signed in with a passkey");
});
