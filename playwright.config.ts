import { defineConfig, devices } from "@playwright/test";

/**
 * Configuração oficial do Playwright para testes E2E (Etapa 4).
 * Utiliza servidor local isolado com serviços simulados (zero publicação real e zero cobrança de APIs).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  timeout: 45_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5179",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node tests/e2e/helpers/start-e2e-stack.mjs",
    url: "http://127.0.0.1:5179/auth",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
