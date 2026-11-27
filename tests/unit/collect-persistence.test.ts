/**
 * @file collect-persistence.test.ts
 * @description Testes de regressão para persistência de estado terminal em collectForUser.
 * Reproduz e protege os quatro caminhos terminais auditados (autenticação, zero commits,
 * erro da IA e sucesso) contra falhas silenciosas ao atualizar 'collection_runs'.
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

interface OpcoesMockSupabase {
  /** Status em collection_runs cuja gravação final deve retornar erro de banco */
  falharUpdateStatus?: string;
}

/**
 * Cria um cliente Supabase determinístico em memória que simula tabelas usadas em collectForUser.
 */
function criarSupabaseMock(opcoes: OpcoesMockSupabase = {}) {
  const atualizacoes: Array<{ status?: string; message?: string }> = [];

  const cliente = {
    from(tabela: string) {
      if (tabela === "collection_runs") {
        return {
          insert() {
            return Promise.resolve({ error: null });
          },
          select() {
            return {
              eq() {
                return this;
              },
              neq() {
                return this;
              },
              in() {
                return this;
              },
              gte() {
                return this;
              },
              order() {
                return this;
              },
              limit() {
                return this;
              },
              maybeSingle() {
                return Promise.resolve({ data: null, error: null });
              },
              single() {
                return Promise.resolve({ data: null, error: { code: "PGRST116" } });
              },
            };
          },
          update(valores: Record<string, unknown>) {
            const status = typeof valores["status"] === "string" ? valores["status"] : undefined;
            const message = typeof valores["message"] === "string" ? valores["message"] : undefined;
            atualizacoes.push({
              ...(status !== undefined ? { status } : {}),
              ...(message !== undefined ? { message } : {}),
            });

            const deveFalhar =
              opcoes.falharUpdateStatus !== undefined && status === opcoes.falharUpdateStatus;

            const cadeia = {
              eq() {
                return cadeia;
              },
              then(
                resolve: (valor: { error: { message: string } | null }) => void,
                reject?: (motivo: unknown) => void,
              ) {
                return Promise.resolve({
                  error: deveFalhar ? { message: "Erro simulado ao gravar collection_runs" } : null,
                }).then(resolve, reject);
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
                    max_commits_per_day: 15,
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
            return {
              eq() {
                return this;
              },
              then(resolve: (valor: { data: Array<{ commit_sha: string }>; error: null }) => void) {
                return Promise.resolve({
                  data: [] as Array<{ commit_sha: string }>,
                  error: null,
                }).then(resolve);
              },
            };
          },
          upsert() {
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
                    return Promise.resolve({ data: { id: "draft-1" }, error: null });
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Tabela não simulada no teste: ${tabela}`);
    },
  };

  return {
    supabase: cliente as unknown as SupabaseClient<Database>,
    atualizacoes,
  };
}

function criarRespostaJson(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("collectForUser — integridade na persistência final de collection_runs", () => {
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

  it("retorna status 'ok' no caminho feliz com zero commits quando a persistência funciona", async () => {
    fetchMock
      .mockResolvedValueOnce(criarRespostaJson({ login: "dev-teste" }))
      .mockResolvedValueOnce(criarRespostaJson([]));

    const { supabase } = criarSupabaseMock();
    const resultado = await collectForUser(supabase, "user-1", "manual", "run-ok-zero");

    expect(resultado.status).toBe("ok");
    expect(resultado.commitsFound).toBe(0);
    expect(resultado.message).toContain("Nenhum commit novo encontrado");
  });

  it("retorna status 'erro' quando falha ao gravar resultado final com zero commits", async () => {
    fetchMock
      .mockResolvedValueOnce(criarRespostaJson({ login: "dev-teste" }))
      .mockResolvedValueOnce(criarRespostaJson([]));

    const { supabase } = criarSupabaseMock({ falharUpdateStatus: "ok" });
    const resultado = await collectForUser(supabase, "user-1", "manual", "run-fail-zero");

    expect(resultado.status).toBe("erro");
    expect(resultado.message).toBe("Não foi possível salvar o resultado da coleta.");
  });

  it("retorna erro de persistência quando falha ao gravar erro de autenticação do GitHub", async () => {
    vi.mocked(getConnectionForUser).mockResolvedValueOnce(null);

    const { supabase } = criarSupabaseMock({ falharUpdateStatus: "erro" });
    const resultado = await collectForUser(supabase, "user-1", "manual", "run-fail-auth");

    expect(resultado.status).toBe("erro");
    expect(resultado.message).toBe("Não foi possível salvar o resultado da coleta.");
  });

  it("retorna erro de persistência quando falha ao gravar erro da camada de IA", async () => {
    fetchMock
      .mockResolvedValueOnce(criarRespostaJson({ login: "dev-teste" }))
      .mockResolvedValueOnce(
        criarRespostaJson([
          { full_name: "dev-teste/app", name: "app", owner: { login: "dev-teste" } },
        ]),
      )
      .mockResolvedValueOnce(
        criarRespostaJson([
          {
            sha: "abcdef1234567890",
            html_url: "https://github.com/dev-teste/app/commit/abcdef1",
            commit: { message: "feat: filtro", author: { date: "2026-11-23T10:00:00Z" } },
          },
        ]),
      )
      .mockResolvedValueOnce(
        criarRespostaJson({
          sha: "abcdef1234567890",
          html_url: "https://github.com/dev-teste/app/commit/abcdef1",
          commit: { message: "feat: filtro", author: { date: "2026-11-23T10:00:00Z" } },
          files: [{ filename: "src/index.ts", status: "modified", additions: 5, deletions: 1 }],
        }),
      );

    vi.mocked(callAi).mockRejectedValueOnce(new Error("Falha simulada na API Gemini"));

    const { supabase } = criarSupabaseMock({ falharUpdateStatus: "erro" });
    const resultado = await collectForUser(supabase, "user-1", "manual", "run-fail-ai");

    expect(resultado.status).toBe("erro");
    expect(resultado.message).toBe("Não foi possível salvar o resultado da coleta.");
  });

  it("retorna status 'erro' quando falha ao gravar o fechamento bem-sucedido da coleta", async () => {
    fetchMock
      .mockResolvedValueOnce(criarRespostaJson({ login: "dev-teste" }))
      .mockResolvedValueOnce(
        criarRespostaJson([
          { full_name: "dev-teste/app", name: "app", owner: { login: "dev-teste" } },
        ]),
      )
      .mockResolvedValueOnce(
        criarRespostaJson([
          {
            sha: "1234567890abcdef",
            html_url: "https://github.com/dev-teste/app/commit/1234567",
            commit: { message: "feat: testes", author: { date: "2026-11-23T11:00:00Z" } },
          },
        ]),
      )
      .mockResolvedValueOnce(
        criarRespostaJson({
          sha: "1234567890abcdef",
          html_url: "https://github.com/dev-teste/app/commit/1234567",
          commit: { message: "feat: testes", author: { date: "2026-11-23T11:00:00Z" } },
          files: [{ filename: "src/index.ts", status: "modified", additions: 10, deletions: 2 }],
        }),
      );

    vi.mocked(callAi).mockResolvedValueOnce({
      summary: "Resumo do dia",
      content: "Post gerado para LinkedIn",
    });

    const { supabase } = criarSupabaseMock({ falharUpdateStatus: "ok" });
    const resultado = await collectForUser(supabase, "user-1", "manual", "run-fail-success");

    expect(resultado.status).toBe("erro");
    expect(resultado.message).toBe("Não foi possível salvar o resultado da coleta.");
  });
});
