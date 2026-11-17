import { defineConfig, devices } from "@playwright/test";

const port = 3100;

/**
 * Browser tests. They run against a production build (`npm run build` first)
 * with every /api call mocked in the browser, so no database, Last.fm or
 * YouTube is needed. Set PLAYWRIGHT_CHROMIUM_PATH to use an installed Chrome.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, args: ["--no-sandbox"] }
      : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
  webServer: {
    command: `npx next start -p ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    env: { DATABASE_URL: process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:1/test" },
    timeout: 60_000,
  },
});
