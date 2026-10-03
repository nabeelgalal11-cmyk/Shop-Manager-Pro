import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.SMOKE_TEST_BASE_URL || "http://127.0.0.1:5173";
const useLocalServers = !process.env.SMOKE_TEST_BASE_URL;

export default defineConfig({
  testDir: "./artifacts/shop-os/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    // Authentication request payloads include the test password; do not persist traces or recordings.
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: useLocalServers
    ? [
        {
          command: "pnpm --filter @workspace/api-server dev",
          url: "http://127.0.0.1:3000/api/auth/me",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: "pnpm --filter @workspace/shop-os dev -- --port 5173",
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ]
    : undefined,
});