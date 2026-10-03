import { expect, test } from "@playwright/test";

const smokeUsername = process.env.SMOKE_TEST_USERNAME;
const smokePassword = process.env.SMOKE_TEST_PASSWORD;

test("signs in and renders the dashboard without the application error boundary", async ({ page }) => {
  if (!smokeUsername || !smokePassword) {
    throw new Error(
      "Set SMOKE_TEST_USERNAME and SMOKE_TEST_PASSWORD to a dedicated non-production test account.",
    );
  }

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.getByText("915motors", { exact: true })).toBeVisible();

  await page.getByLabel("Username").fill(smokeUsername);
  await page.getByLabel("Password").fill(smokePassword);
  await page.getByRole("button", { name: "Sign In" }).click();

  const errorBoundary = page.getByRole("heading", {
    name: "The app could not finish loading",
  });
  const loginError = page.getByText("Invalid credentials", { exact: true });
  const dashboard = page.getByRole("heading", { name: "Dashboard" });

  const startupStateHandle = await page.waitForFunction(
    () => {
      const bodyText = document.body.innerText;
      if (bodyText.includes("The app could not finish loading")) return "error-boundary";
      if (bodyText.includes("Invalid credentials")) return "login-rejected";
      if (document.querySelector("h1")?.textContent?.trim() === "Dashboard") return "dashboard";
      return null;
    },
    undefined,
    { timeout: 30_000 },
  );
  const startupState = await startupStateHandle.jsonValue();
  expect(
    startupState,
    `Authenticated startup did not reach the dashboard; observed state: ${startupState}. ` +
      "Check the smoke account, API session, and authenticated React providers.",
  ).toBe("dashboard");

  await expect(dashboard).toBeVisible();
  await expect(errorBoundary).not.toBeVisible();
  await expect(loginError).not.toBeVisible();

  expect(
    pageErrors,
    `Authenticated startup raised browser errors: ${pageErrors.join("; ")}`,
  ).toEqual([]);
});