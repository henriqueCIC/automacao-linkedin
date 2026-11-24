/**
 * Inicializa o servidor local de serviços simulados (porta 54329) e o servidor Vite/TanStack Start
 * dedicado aos testes E2E (porta 5179) com variáveis de ambiente totalmente isoladas.
 */

import { spawn } from "node:child_process";
import { E2E_ENCRYPTION_SECRET, iniciarServidorMockE2E } from "./mock-services-server.mjs";

const MOCK_PORT = 54329;
const APP_PORT = 5179;
const MOCK_BASE = `http://127.0.0.1:${MOCK_PORT}`;

const mockServer = await iniciarServidorMockE2E(MOCK_PORT);

const viteProcess = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["vite", "dev", "--host", "127.0.0.1", "--port", String(APP_PORT), "--strictPort"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      SUPABASE_URL: MOCK_BASE,
      VITE_SUPABASE_URL: MOCK_BASE,
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e_local",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e_local",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_e2e_local",
      ENCRYPTION_SECRET: E2E_ENCRYPTION_SECRET,
      GEMINI_API_KEY: "e2e-gemini-key-simulada",
      GEMINI_MODEL: "gemini-3.8-flash",
      GEMINI_API_BASE_URL: `${MOCK_BASE}/gemini`,
      GITHUB_API_BASE_URL: `${MOCK_BASE}/github`,
      LINKEDIN_API_BASE_URL: `${MOCK_BASE}/linkedin`,
      CRON_SECRET: "e2e-cron-secret",
    },
  },
);

function encerrar() {
  viteProcess.kill("SIGTERM");
  mockServer.close();
}

process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
viteProcess.on("exit", (code) => {
  mockServer.close();
  process.exit(code ?? 0);
});
