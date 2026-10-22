import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:8090",
    browserName: "chromium",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm exec tsx -- tests/fixtures/browser-server.ts",
      url: "http://127.0.0.1:8091/.well-known/jwks.json",
      reuseExistingServer: false,
    },
    {
      command: "npm run start -- --port 8090",
      url: "http://localhost:8090/healthz",
      reuseExistingServer: false,
      env: {
        PUBLIC_URL: "http://localhost:8090",
        CAMPUS_BASE_URL: "http://127.0.0.1:8091/api/backend",
        CAMPUS_ISSUER: "https://fixture-campus.example/",
        INSPECTOR_PASSWORD: "fixture-only-long-password",
        ALLOW_LOCAL_HTTP: "true",
        DATA_DIR: "/tmp/campus-inspector-e2e-" + process.pid,
      },
    },
  ],
  timeout: 30000,
});
