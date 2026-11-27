/**
 * @file prompts.test.ts
 * @description Testes unitários para normalização de tons e construção de prompts de IA.
 * Garante a separação entre roadmap interno e conteúdo de posts (IA03) e consistência de tons (T01).
 */

import { describe, expect, it } from "vitest";
import {
  DESCRICAO_TONS,
  TOM_PADRAO,
  construirPromptColetaCommits,
  construirPromptRascunhoManual,
  construirPromptRefinamento,
  normalizarTom,
} from "@/lib/prompts";

describe("normalizarTom", () => {
  it("aceita todos os tons oficiais e ignora espaços e maiúsculas", () => {
    expect(normalizarTom("profissional")).toBe("profissional");
    expect(normalizarTom("  Narrativo ")).toBe("narrativo");
    expect(normalizarTom("TECNICO")).toBe("tecnico");
  });

  it("converte o alias legado 'storytelling' para 'narrativo'", () => {
    expect(normalizarTom("storytelling")).toBe("narrativo");
  });

  it("usa o tom padrão quando recebe valores nulos, vazios ou desconhecidos", () => {
    expect(normalizarTom(undefined)).toBe(TOM_PADRAO);
    expect(normalizarTom(null)).toBe(TOM_PADRAO);
    expect(normalizarTom("")).toBe(TOM_PADRAO);
    expect(normalizarTom("informal-inexistente")).toBe(TOM_PADRAO);
  });
});

describe("construirPromptColetaCommits", () => {
  it("aplica explicitamente o tom escolhido pelo usuário e não injeta roadmap interno fixo", () => {
    const prompt = construirPromptColetaCommits({
      loginUsuario: "henriqueCIC",
      desdeQuando: "2026-11-22T18:00:00Z",
      ateQuando: "2026-11-23T18:00:00Z",
      blocosCommits: ["Repositório: henriqueCIC/app\nCommit: feat: cria filtros unitários"],
      tom: "tecnico",
    });

    expect(prompt.tomAplicado).toBe("tecnico");
    expect(prompt.user).toContain("tecnico");
    expect(prompt.user).toContain(DESCRICAO_TONS.tecnico);
    expect(prompt.user).toContain("henriqueCIC/app");

    // Garante remoção total do vazamento do roadmap interno no prompt (IA03)
    expect(prompt.system).not.toContain("Próximos 5 passos");
    expect(prompt.system).not.toContain("Resend ou SendGrid");
    expect(prompt.system).not.toContain("Contexto do roadmap");
    expect(prompt.user).not.toContain("Próximos 5 passos");
  });

  it("faz fallback para tom profissional quando o tom configurado não é reconhecido", () => {
    const prompt = construirPromptColetaCommits({
      loginUsuario: "dev",
      desdeQuando: "2026-11-22T00:00:00Z",
      ateQuando: "2026-11-23T00:00:00Z",
      blocosCommits: ["Commit: fix: corrige validação"],
      tom: "invalido",
    });

    expect(prompt.tomAplicado).toBe("profissional");
    expect(prompt.user).toContain(DESCRICAO_TONS.profissional);
  });
});

describe("construirPromptRascunhoManual e construirPromptRefinamento", () => {
  it("monta prompt manual com data, tom e anotações preservadas", () => {
    const prompt = construirPromptRascunhoManual({
      dataEntrada: "2026-11-23",
      anotacoes: "Implementei testes de integração com mocks HTTP no Vitest.",
      tom: "narrativo",
    });

    expect(prompt.tomAplicado).toBe("narrativo");
    expect(prompt.user).toContain("2026-11-23");
    expect(prompt.user).toContain(DESCRICAO_TONS.narrativo);
    expect(prompt.user).toContain("testes de integração");
  });

  it("monta prompt de refinamento preservando anotações, versão atual e ajustes solicitados", () => {
    const prompt = construirPromptRefinamento({
      anotacoesOriginais: "Dia de refatoração de filtros.",
      conteudoAtual: "Texto inicial do post.",
      feedbackUsuario: "Deixe o gancho inicial mais direto.",
      tom: "profissional",
    });

    expect(prompt.tomAplicado).toBe("profissional");
    expect(prompt.user).toContain("Dia de refatoração de filtros.");
    expect(prompt.user).toContain("Texto inicial do post.");
    expect(prompt.user).toContain("Deixe o gancho inicial mais direto.");
  });
});
