import { defineConfig, devices } from "@playwright/test";

const testPort = process.env.DOCUFLOW_PLAYWRIGHT_PORT || "5187";
const testUrl = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: testUrl,
    trace: "retain-on-failure",
  },
  timeout: 15_000,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${testPort} --strictPort`,
    url: testUrl,
    reuseExistingServer: false,
    env: {
      VITE_API_BASE_URL: "http://127.0.0.1:8787",
      VITE_COGNITO_AUTH_DOMAIN: "https://login.example.test",
      VITE_COGNITO_CLIENT_ID: "test-client-id",
      VITE_COGNITO_REDIRECT_URI: `${testUrl}/auth/callback`,
    },
  },
});
