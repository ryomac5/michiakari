import { defineConfig, devices } from "@playwright/test";
import { buildWebServers, stubExternal, webUrl } from "./servers.ts";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // next dev と決定論 agent を共有するため、CPU 数に比例して判断要求を増やさない
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: webUrl,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: buildWebServers({ stubExternal }),
});
