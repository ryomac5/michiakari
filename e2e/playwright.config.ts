import { defineConfig, devices } from "@playwright/test";

const webUrl = "http://localhost:3000";
const agentUrl = "http://localhost:8787";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @repo/web dev",
      url: webUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @repo/agent start",
      url: `${agentUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
