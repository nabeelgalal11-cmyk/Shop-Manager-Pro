import { expect, test, type Page } from "@playwright/test";

async function openInventoryCreatePage(page: Page, failureStatus: 403 | 500) {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: 1,
          username: "inventory-test-admin",
          firstName: "Test",
          lastName: "Admin",
          email: null,
          role: "admin",
          roles: ["admin"],
          active: true,
        },
        permissions: [],
      }),
    });
  });
  await page.route("**/api/inventory**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], total: 0, page: 1, limit: 200 }),
      });
      return;
    }
    await route.fulfill({
      status: failureStatus,
      contentType: "application/json",
      body: JSON.stringify({
        error: failureStatus === 403
          ? "Forbidden"
          : "The inventory item could not be saved. Please try again.",
      }),
    });
  });

  await page.goto("/inventory/new");
  await expect(page.getByRole("heading", { name: "Add Inventory Item" })).toBeVisible();
  await page.getByPlaceholder("e.g. Premium Front Brake Pads").fill("Test brake pads");
  await page.getByText("Select a category...").click();
  await page.locator('[role="option"]').filter({ hasText: "Add new category..." }).click();
  await page.getByPlaceholder("Type new category name...").fill("Test Parts");
}

for (const scenario of [
  {
    name: "permission denial",
    status: 403 as const,
    visibleMessage: "You don't have permission to add inventory items.",
  },
  {
    name: "database failure",
    status: 500 as const,
    visibleMessage: "The inventory item could not be saved. Please try again.",
  },
]) {
  test(`inventory create keeps a visible error after ${scenario.name}`, async ({ page }) => {
    await openInventoryCreatePage(page, scenario.status);
    await page.getByRole("button", { name: "Add to Inventory" }).click();

    await expect(page.getByRole("alert")).toHaveText(scenario.visibleMessage);
    await expect(page.getByRole("button", { name: "Add to Inventory" })).toBeEnabled();
    await expect(page).toHaveURL(/\/inventory\/new$/);
  });
}