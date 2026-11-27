import { defineConfig } from "vitest/config";

/**
 * Configuração dedicada do Vitest para testes unitários e de integração.
 * Mantida separada de vite.config.ts para isolar o runner de plugins de SSR do TanStack Start.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
