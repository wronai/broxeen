import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

// Load test environment variables
const testEnv = loadEnv("test", process.cwd(), "");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    permissions: ["microphone"],
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--use-file-for-fake-audio-capture=e2e/fixtures/test_speech.wav",
            "--allow-file-access-from-files",
          ],
        },
      },
    },
  ],
  webServer: {
    command: "corepack npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: testEnv,
  },
});
