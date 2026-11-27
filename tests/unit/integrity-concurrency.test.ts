/**
 * @file integrity-concurrency.test.ts
 * @description Testes unitários e de regressão para a Subetapa 3.2 (Integridade e Concorrência):
 * - D01: seen_commits só é gravado após confirmação de day_entries e post_drafts.
 * - D02: paginação e preservação da marca d'água temporal quando max_commits_per_day trunca commits.
 * - P01: reserva atômica contra publicação concorrente, reversão segura em falhas definidas,
 *        bloqueio em falhas incertas e reconciliação idempotente quando linkedin_post_id já existe.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

vi.mock("@/lib/appUserConnections.server", () => ({
  GITHUB_CONNECTOR_ID: "github",
  getConnectionForUser: vi.fn(),
  markReconnectRequired: vi.fn(),
  saveAccountLogin: vi.fn(),
}));

vi.mock("@/lib/ai.server", () => ({
  callAi: vi.fn(),
}));

import { collectForUser } from "@/lib/collect.server";
import { getConnectionForUser, saveAccountLogin } from "@/lib/appUserConnections.server";
import { callAi } from "@/lib/ai.server";
import { publicarRascunhoAprovadoNoLinkedIn } from "@/lib/linkedin.server";

function respostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface OpcoesMockColetaIntegridade {
  maxCommitsPerDay?: number;
  falharPostDraftInsert?: boolean;
  coletaAtivaExistente?: boolean;
}

function criarSupabaseColetaIntegridadeMock(opcoes: OpcoesMockColetaIntegridade = {}) {
  const commitsMarcados: Array<{ repo_full_name: string; commit_sha: string }> = [];
  const updatesCollectionRuns: Array<Record<string, unknown>> = [];

  const cliente = {
    from(tabela: string) {
      if (tabela === "collection_runs") {
        return {
          insert() {
            return Promise.resolve({ error: null });
          },
          select(colunas: string) {
            const filtros: Record<string, unknown> = {};
            let filtroInStatus: string[] | null = null;
            const query = {
              eq(col: string, val: unknown) {
                filtros[col] = val;
                return query;
              },
              neq() {
                return query;
              },
              in(_col: string, valores: string[]) {
                filtroInStatus = valores;
                return query;
              },
              gte() {
                return query;
              },
              order() {
                return query;
              },
              limit() {
                return query;
              },
              maybeSingle() {
                if (filtroInStatus && opcoes.coletaAtivaExistente) {
                  return Promise.resolve({ data: { id: "run-em-andamento" }, error: null });
                }
                return Promise.resolve({ data: null, error: null });
              },
              single() {
                if (colunas === "until_at") {
                  return Promise.resolve({
                    data: { until_at: "2026-11-22T18:00:00.000Z" },
                    error: null,
                  });
                }
                return Promise.resolve({ data: null, error: { code: "PGRST116" } });
              },
            };
            return query;
          },
          update(valores: Record<string, unknown>) {
            updatesCollectionRuns.push(valores);
            const cadeia = {
              eq() {
                return cadeia;
              },
              then(resolve: (v: { error: null }) => void) {
                return Promise.resolve({ error: null }).then(resolve);
              },
            };
            return cadeia;
          },
        };
      }

      if (tabela === "automation_settings") {
        return {
          select() {
            return {
              eq() {
                return this;
              },
              single() {
                return Promise.resolve({
                  data: {
                    user_id: "user-1",
                    enabled: true,
                    daily_time: "18:00",
                    timezone: "America/Bahia",
                    default_tone: "profissional",
                    max_commits_per_day: opcoes.maxCommitsPerDay ?? 15,
                    notify_desktop: true,
                    notify_email: false,
                  },
                  error: null,
                });
              },
            };
          },
        };
      }

      if (tabela === "seen_commits") {
        return {
          select() {
            const cadeia = {
              eq() {
                return cadeia;
              },
              then(resolve: (v: { data: Array<{ commit_sha: string }>; error: null }) => void) {
                return Promise.resolve({
                  data: commitsMarcados.map((c) => ({ commit_sha: c.commit_sha })),
                  error: null,
                }).then(resolve);
              },
            };
            return cadeia;
          },
          upsert(payload: unknown) {
            const lista = Array.isArray(payload) ? payload : [payload];
            for (const item of lista) {
              const reg = item as { repo_full_name: string; commit_sha: string };
              commitsMarcados.push(reg);
            }
            return Promise.resolve({ error: null });
          },
        };
      }

      if (tabela === "day_entries") {
        return {
          insert() {
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({ data: { id: "entry-1" }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      if (tabela === "post_drafts") {
        return {
          insert() {
            return {
              select() {
                return {
                  single() {
                    if (opcoes.falharPostDraftInsert) {
                      return Promise.resolve({
                        data: null,
                        error: new Error("Falha simulada ao salvar post_drafts"),
                      });
                    }
                    return Promise.resolve({ data: { id: "draft-1" }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Tabela inesperada: ${tabela}`);
    },
  };

  return {
    supabase: cliente as unknown as SupabaseClient<Database>,
    commitsMarcados,
    updatesCollectionRuns,
  };
}

describe("D01 e D02 — Confirmação pós-persistência de seen_commits e preservação de excedentes", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(getConnectionForUser).mockResolvedValue({
      connectionAPIKey: "gho_token_teste",
      accountLogin: "dev-teste",
      reconnectRequired: false,
    });
    vi.mocked(saveAccountLogin).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("D01: NÃO grava seen_commits se a IA falhar, preservando o commit para a próxima tentativa", async () => {
    fetchMock
      .mockResolvedValueOnce(respostaJson({ login: "dev-teste" }))
      .mockResolvedValueOnce(
        respostaJson([
          {
            full_name: "dev-teste/app",
            name: "app",
            owner: { login: "dev-teste" },
            pushed_at: "2026-11-23T12:00:00Z",
          },
        ]),
      )
      .mockResolvedValueOnce(
        respostaJson([
          {
            sha: "sha_nao_deve_perder",
            html_url: "https://github.com/dev-teste/app/commit/1",
            commit: { message: "feat: importante", author: { date: "2026-11-23T12:00:00Z" } },
          },
        ]),
      )
      .mockResolvedValueOnce(
        respostaJson({
          sha: "sha_nao_deve_perder",
          html_url: "https://github.com/dev-teste/app/commit/1",
          commit: { message: "feat: importante", author: { date: "2026-11-23T12:00:00Z" } },
          files: [{ filename: "src/app.ts", status: "modified", additions: 4, deletions: 1 }],
        }),
      );

    vi.mocked(callAi).mockRejectedValueOnce(new Error("Gemini indisponível"));

    const { supabase, commitsMarcados } = criarSupabaseColetaIntegridadeMock();
    const resultado = await collectForUser(supabase, "user-1", "manual", "run-d01-ai-fail");

    expect(resultado.status).toBe("erro");
    expect(commitsMarcados).toHaveLength(0);
  });

  it("D01: NÃO grava seen_commits se a inserção de post_drafts falhar", async () => {
    fetchMock
      .mockResolvedValueOnce(respostaJson({ login: "dev-teste" }))
      .mockResolvedValueOnce(
        respostaJson([
          {
            full_name: "dev-teste/app",
            name: "app",
            owner: { login: "dev-teste" },
            pushed_at: "2026-11-23T12:00:00Z",
          },
        ]),
      )
      .mockResolvedValueOnce(
        respostaJson([
          {
            sha: "sha_protegido_banco",
            html_url: "https://github.com/dev-teste/app/commit/2",
            commit: { message: "feat: banco", author: { date: "2026-11-23T12:00:00Z" } },
          },
        ]),
      )
      .mockResolvedValueOnce(
        respostaJson({
          sha: "sha_protegido_banco",
          html_url: "https://github.com/dev-teste/app/commit/2",
          commit: { message: "feat: banco", author: { date: "2026-11-23T12:00:00Z" } },
          files: [{ filename: "src/db.ts", status: "modified", additions: 8, deletions: 0 }],
        }),
      );

    vi.mocked(callAi).mockResolvedValueOnce({
      summary: "Resumo válido do dia de trabalho.",
      content: "Post completo válido gerado para revisão humana no painel.",
    });

    const { supabase, commitsMarcados } = criarSupabaseColetaIntegridadeMock({
      falharPostDraftInsert: true,
    });
    const resultado = await collectForUser(supabase, "user-1", "manual", "run-d01-db-fail");

    expect(resultado.status).toBe("erro");
    expect(commitsMarcados).toHaveLength(0);
  });

  it("D02: processa os commits mais antigos primeiro e não avança until_at quando restam excedentes", async () => {
    fetchMock
      .mockResolvedValueOnce(respostaJson({ login: "dev-teste" }))
      .mockResolvedValueOnce(
        respostaJson([
          {
            full_name: "dev-teste/app",
            name: "app",
            owner: { login: "dev-teste" },
            pushed_at: "2026-11-23T15:00:00Z",
          },
        ]),
      )
      .mockResolvedValueOnce(
        respostaJson([
          {
            sha: "sha_mais_recente",
            html_url: "https://github.com/dev-teste/app/commit/novo",
            commit: { message: "feat: commit 2", author: { date: "2026-11-23T15:00:00Z" } },
          },
          {
            sha: "sha_mais_antigo",
            html_url: "https://github.com/dev-teste/app/commit/antigo",
            commit: { message: "feat: commit 1", author: { date: "2026-11-23T10:00:00Z" } },
          },
        ]),
      )
      .mockResolvedValueOnce(
        respostaJson({
          sha: "sha_mais_antigo",
          html_url: "https://github.com/dev-teste/app/commit/antigo",
          commit: { message: "feat: commit 1", author: { date: "2026-11-23T10:00:00Z" } },
          files: [{ filename: "src/um.ts", status: "added", additions: 10, deletions: 0 }],
        }),
      );

    vi.mocked(callAi).mockResolvedValueOnce({
      summary: "Resumo do primeiro commit.",
      content: "Conteúdo válido gerado a partir do commit mais antigo da fila.",
    });

    const { supabase, commitsMarcados, updatesCollectionRuns } = criarSupabaseColetaIntegridadeMock(
      { maxCommitsPerDay: 1 },
    );

    const resultado = await collectForUser(supabase, "user-1", "manual", "run-d02-trunc");

    expect(resultado.status).toBe("ok");
    expect(resultado.commitsFound).toBe(1);
    expect(commitsMarcados).toHaveLength(1);
    expect(commitsMarcados[0]!.commit_sha).toBe("sha_mais_antigo");

    const fechamentoOk = updatesCollectionRuns.find((u) => u["status"] === "ok");
    // until_at deve permanecer em desdeQuando (2026-11-22T18:00:00.000Z) para não perder sha_mais_recente!
    expect(fechamentoOk?.["until_at"]).toBe("2026-11-22T18:00:00.000Z");
  });

  it("bloqueia sobreposição quando já existe uma coleta ativa em andamento para o mesmo usuário", async () => {
    const { supabase } = criarSupabaseColetaIntegridadeMock({ coletaAtivaExistente: true });
    const resultado = await collectForUser(supabase, "user-1", "manual", "run-concorrente");

    expect(resultado.status).toBe("ignorado");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("P01 — Reserva atômica, concorrência e reconciliação na publicação LinkedIn", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(getConnectionForUser).mockResolvedValue({
      connectionAPIKey: "li_token_individual",
      accountLogin: "henrique",
      reconnectRequired: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function criarSupabaseDraftMock(estadoInicial: {
    id: string;
    content: string;
    status: string;
    linkedin_post_id: string | null;
    published_at: string | null;
  }) {
    const estado = { ...estadoInicial };

    const supabase = {
      from(tabela: string) {
        if (tabela !== "post_drafts") throw new Error(`Tabela inesperada: ${tabela}`);
        return {
          select() {
            const cadeia = {
              eq() {
                return cadeia;
              },
              single() {
                return Promise.resolve({ data: { ...estado }, error: null });
              },
            };
            return cadeia;
          },
          update(valores: Record<string, unknown>) {
            const filtrosEq: Record<string, unknown> = {};
            let exigePostIdNull = false;

            const aplicarSeElegivel = () => {
              if (filtrosEq["status"] !== undefined && estado.status !== filtrosEq["status"]) {
                return false;
              }
              if (exigePostIdNull && estado.linkedin_post_id !== null) {
                return false;
              }
              Object.assign(estado, valores);
              return true;
            };

            const cadeia = {
              eq(col: string, val: unknown) {
                filtrosEq[col] = val;
                return cadeia;
              },
              is(col: string, val: unknown) {
                if (col === "linkedin_post_id" && val === null) exigePostIdNull = true;
                return cadeia;
              },
              select() {
                return {
                  maybeSingle() {
                    const aplicou = aplicarSeElegivel();
                    return Promise.resolve({
                      data: aplicou ? { ...estado } : null,
                      error: null,
                    });
                  },
                };
              },
              then(resolve: (v: { error: null }) => void) {
                aplicarSeElegivel();
                return Promise.resolve({ error: null }).then(resolve);
              },
            };
            return cadeia;
          },
        };
      },
    } as unknown as SupabaseClient<Database>;

    return { supabase, estado };
  }

  it("reconcilia sem republicar quando o rascunho já possui linkedin_post_id gravado", async () => {
    const { supabase, estado } = criarSupabaseDraftMock({
      id: "draft-1",
      content: "Conteúdo aprovado",
      status: "publicando",
      linkedin_post_id: "urn:li:share:99999",
      published_at: null,
    });

    const res = await publicarRascunhoAprovadoNoLinkedIn(supabase, "user-1", "draft-1");

    expect(res.ok).toBe(true);
    expect(res.postId).toBe("urn:li:share:99999");
    expect(res.reconciliado).toBe(true);
    expect(estado.status).toBe("publicado");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("impede publicação duplicada quando duas chamadas concorrentes disputam o mesmo rascunho", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      await new Promise((r) => setTimeout(r, 15));
      if (url.endsWith("/v2/userinfo")) {
        return respostaJson({ sub: "pessoa-123" });
      }
      return respostaJson({ id: "urn:li:share:12345" }, 201);
    });

    const { supabase, estado } = criarSupabaseDraftMock({
      id: "draft-corrida",
      content: "Post único sem duplicar",
      status: "aprovado",
      linkedin_post_id: null,
      published_at: null,
    });

    const [r1, r2] = await Promise.allSettled([
      publicarRascunhoAprovadoNoLinkedIn(supabase, "user-1", "draft-corrida"),
      publicarRascunhoAprovadoNoLinkedIn(supabase, "user-1", "draft-corrida"),
    ]);

    const sucessos = [r1, r2].filter((r) => r.status === "fulfilled");
    const falhas = [r1, r2].filter((r) => r.status === "rejected");

    expect(sucessos).toHaveLength(1);
    expect(falhas).toHaveLength(1);
    expect(estado.status).toBe("publicado");
    expect(estado.linkedin_post_id).toBe("urn:li:share:12345");
  });

  it("mantém status 'publicando' para reconciliação quando ocorre falha incerta (timeout/5xx) no POST ugcPosts", async () => {
    fetchMock
      .mockResolvedValueOnce(respostaJson({ sub: "pessoa-123" }))
      .mockRejectedValueOnce(new DOMException("Timeout", "TimeoutError"));

    const { supabase, estado } = criarSupabaseDraftMock({
      id: "draft-incerto",
      content: "Post com falha de rede incerta",
      status: "aprovado",
      linkedin_post_id: null,
      published_at: null,
    });

    await expect(
      publicarRascunhoAprovadoNoLinkedIn(supabase, "user-1", "draft-incerto"),
    ).rejects.toThrow(/incerto|reconcilia|confirme/i);

    expect(estado.status).toBe("publicando");
  });

  it("reverte status para 'aprovado' quando o LinkedIn recusa definitivamente com HTTP 422 antes de publicar", async () => {
    fetchMock
      .mockResolvedValueOnce(respostaJson({ sub: "pessoa-123" }))
      .mockResolvedValueOnce(new Response("Unprocessable Entity", { status: 422 }));

    const { supabase, estado } = criarSupabaseDraftMock({
      id: "draft-422",
      content: "Post recusado por validação",
      status: "aprovado",
      linkedin_post_id: null,
      published_at: null,
    });

    await expect(
      publicarRascunhoAprovadoNoLinkedIn(supabase, "user-1", "draft-422"),
    ).rejects.toThrow(/422/);

    expect(estado.status).toBe("aprovado");
  });
});
