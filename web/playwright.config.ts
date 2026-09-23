import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: process.env.APP_URL ?? "http://127.0.0.1:8080",
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH,
    },
    screenshot: "only-on-failure",
  },
  workers: 1,
});
