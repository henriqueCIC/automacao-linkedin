/**
 * @file commit-file-filter.test.ts
 * @description Testes unitários determinísticos para o filtro anti-ruído de arquivos de commits.
 * Valida aceitação de código relevante, descarte de lockfiles/mídia/diretórios gerados
 * e prevenção de falsos positivos por fronteira de segmento (ex.: build/ versus rebuild/).
 */

import { describe, expect, it } from "vitest";
import { REGRAS_FILTRO_ANTI_RUIDO, deveIncluirArquivo } from "@/lib/commit-file-filter";

describe("deveIncluirArquivo", () => {
  it("inclui arquivos de código-fonte, configuração autoral e documentação", () => {
    const arquivosRelevantes = [
      "src/lib/collect.server.ts",
      "src/routes/index.tsx",
      "supabase/migrations/20260917_init.sql",
      "package.json",
      "tsconfig.json",
      "README.md",
      "src/styles.css",
      "vitest.config.ts",
    ];

    for (const caminho of arquivosRelevantes) {
      expect(deveIncluirArquivo(caminho), `deveria incluir ${caminho}`).toBe(true);
    }
  });

  it("rejeita lockfiles na raiz e em subdiretórios", () => {
    const lockfiles = [
      "package-lock.json",
      "apps/web/package-lock.json",
      "yarn.lock",
      "packages/ui/yarn.lock",
      "pnpm-lock.yaml",
      "bun.lock",
      "bun.lockb",
      "composer.lock",
      "Gemfile.lock",
      "Cargo.lock",
      "poetry.lock",
    ];

    for (const caminho of lockfiles) {
      expect(deveIncluirArquivo(caminho), `deveria ignorar ${caminho}`).toBe(false);
    }
  });

  it("rejeita imagens, vetores SVG, fontes, mídia pesada e binários compactados", () => {
    const midiasEBinarios = [
      "public/logo.png",
      "assets/HERO.PNG",
      "public/foto.jpg",
      "public/foto.jpeg",
      "assets/animacao.gif",
      "public/favicon.ico",
      "assets/banner.webp",
      "src/assets/icone.svg",
      "public/fonts/inter.woff",
      "public/fonts/inter.woff2",
      "public/fonts/inter.ttf",
      "public/fonts/inter.otf",
      "public/fonts/inter.eot",
      "docs/demo.mp4",
      "assets/audio.mp3",
      "docs/relatorio.pdf",
      "releases/app.zip",
      "releases/app.tar.gz",
    ];

    for (const caminho of midiasEBinarios) {
      expect(deveIncluirArquivo(caminho), `deveria ignorar ${caminho}`).toBe(false);
    }
  });

  it("rejeita diretórios gerados, dependências externas e internos do Git", () => {
    const gerados = [
      "dist/index.js",
      "packages/api/dist/server.mjs",
      "build/main.js",
      "apps/mobile/build/bundle.js",
      ".next/static/chunks/app.js",
      "apps/web/.next/server/page.js",
      ".output/server/index.mjs",
      "coverage/lcov-report/index.html",
      "packages/core/coverage/summary.json",
      "node_modules/react/index.js",
      "packages/web/node_modules/zod/index.js",
      ".git/HEAD",
      "submodulo/.git/config",
    ];

    for (const caminho of gerados) {
      expect(deveIncluirArquivo(caminho), `deveria ignorar ${caminho}`).toBe(false);
    }
  });

  it("não gera falsos positivos quando nomes de pastas ou arquivos apenas terminam com palavras ignoradas", () => {
    const caminhosComFronteiraParecida = [
      "src/rebuild/index.ts",
      "src/prebuild/setup.ts",
      "src/builder/form.ts",
      "src/redist/cache.ts",
      "src/distributed/queue.ts",
      "src/uncoverage/report.ts",
      "src/custom_node_modules/helper.ts",
      "src/my-package-lock.json",
      "docs/about-yarn.lock.md",
      "src/my-bun.lockb.ts",
    ];

    for (const caminho of caminhosComFronteiraParecida) {
      expect(deveIncluirArquivo(caminho), `não deveria rejeitar ${caminho}`).toBe(true);
    }
  });

  it("normaliza separadores invertidos de caminhos estilo Windows", () => {
    expect(deveIncluirArquivo("apps\\web\\build\\bundle.js")).toBe(false);
    expect(deveIncluirArquivo("apps\\web\\package-lock.json")).toBe(false);
    expect(deveIncluirArquivo("src\\rebuild\\index.ts")).toBe(true);
  });

  it("mantém todas as regras documentadas com categoria e justificativa em português", () => {
    expect(REGRAS_FILTRO_ANTI_RUIDO.length).toBeGreaterThan(0);
    for (const regra of REGRAS_FILTRO_ANTI_RUIDO) {
      expect(regra.padrao).toBeInstanceOf(RegExp);
      expect(regra.justificativa.trim().length).toBeGreaterThan(10);
    }
  });
});
