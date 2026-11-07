import { expect, test } from "@playwright/test";
import { loginAsDemoUser } from "./helpers/auth";

test("settings and profile pages render runtime and operator details", async ({ page }) => {
  await loginAsDemoUser(page);

  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "Deployment Status" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Database, Cache, Object Storage" })).toBeVisible();
  await expect(page.getByText("Redis Cache")).toBeVisible();

  await page.goto("/profile");
  await expect(page).toHaveURL(/\/settings\/profile$/);
  await expect(page.getByRole("heading", { name: "Public profile" })).toBeVisible();
  await expect(page.getByText("Your account", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Display name" })).toBeVisible();
  await expect(page.getByLabel("Bio")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Timezone" })).toBeVisible();

  await page.getByRole("link", { name: "Account", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Email address" })).toBeVisible();
  await expect(page.getByText("demo@qnetward.local").first()).toBeVisible();

  await page.goto("/settings/security");
  await expect(page.getByRole("button", { name: /change password/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /email me a reset link/i })).toBeVisible();

  await page.goto("/settings/workspaces");
  await expect(page.getByText("Kestrel Labs").first()).toBeVisible();
});
