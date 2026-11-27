/**
 * @file adversarial-domain-edges.test.ts
 * @description Testes adversariais de casos de borda para:
 * - `executarComBackoff` (`src/lib/observability.server.ts`): recuperação após falha transitória, predicado `deveRepetir` e limite máximo de tentativas
 * - `autenticarRequisicaoCron` e `executarCicloCron` (`src/lib/cron.server.ts`): rejeição de segredo inválido, janela horária ainda não atingida e execução já concluída no dia
 * - `publicarRascunhoAprovadoNoLinkedIn` (`src/lib/linkedin.server.ts`): bloqueio de status não-aprovado ("rascunho" / "rejeitado"), ausência de conexão LinkedIn e reversão para "aprovado" quando `/v2/userinfo` falha com HTTP 401
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autenticarRequisicaoCron, executarCicloCron } from "@/lib/cron.server";
import { publicarRascunhoAprovadoNoLinkedIn } from "@/lib/linkedin.server";
import { executarComBackoff } from "@/lib/observability.server";

const estadoMock = {
  cronSecretBanco: "segredo-cron-super-forte-123",
  settingsRows: [] as Array<{
    user_id: string;
    enabled: boolean;
    daily_time: string;
    timezone: string;
    last_run_date: string | null;
  }>,
  draftRow: null as {
    id: string;
    user_id: string;
    content: string;
    status: string;
    linkedin_post_id: string | null;
    published_at: string | null;
  } | null,
  tokenLinkedIn: "li_token_valido" as string | null,
};

function criarSupabaseAdminCronMock() {
  return {
    from: (table: string) => {
      if (table === "cron_secrets") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: estadoMock.cronSecretBanco ? { secret: estadoMock.cronSecretBanco } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "automation_settings") {
        return {
          select: () => ({
            eq: async () => ({
              data: estadoMock.settingsRows.filter((s) => s.enabled),
              error: null,
            }),
          }),
          update: (patch: { last_run_date: string }) => ({
            eq: async (_col: string, userId: string) => {
              const alvo = estadoMock.settingsRows.find((s) => s.user_id === userId);
              if (alvo) alvo.last_run_date = patch.last_run_date;
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`Tabela não mapeada no mock adversarial: ${table}`);
    },
  };
}

vi.mock("@/lib/appUserConnections.server", () => ({
  getConnectionForUser: vi.fn(async () =>
    estadoMock.tokenLinkedIn
      ? {
          connectionAPIKey: estadoMock.tokenLinkedIn,
          accountLogin: "henrique-li",
          reconnectRequired: false,
        }
      : null,
  ),
}));

function criarSupabaseMockLinkedIn() {
  return {
    from: (table: string) => {
      if (table !== "post_drafts") throw new Error(`Tabela inesperada: ${table}`);
      return {
        select: () => ({
          eq: (_c1: string, id: string) => ({
            eq: (_c2: string, userId: string) => ({
              single: async () => {
                if (
                  !estadoMock.draftRow ||
                  estadoMock.draftRow.id !== id ||
                  estadoMock.draftRow.user_id !== userId
                ) {
                  return { data: null, error: { message: "Não encontrado" } };
                }
                return { data: { ...estadoMock.draftRow }, error: null };
              },
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_c1: string, id: string) => ({
            eq: (_c2: string, userId: string) => {
              const aplicarUpdate = () => {
                if (
                  estadoMock.draftRow &&
                  estadoMock.draftRow.id === id &&
                  estadoMock.draftRow.user_id === userId
                ) {
                  Object.assign(estadoMock.draftRow, patch);
                  return { data: { ...estadoMock.draftRow }, error: null };
                }
                return { data: null, error: null };
              };
              return {
                eq: (_c3: string, statusEsperado: string) => {
                  const promessaEqStatus = Promise.resolve().then(() => {
                    if (estadoMock.draftRow?.status === statusEsperado) {
                      aplicarUpdate();
                    }
                    return { error: null };
                  });
                  return Object.assign(promessaEqStatus, {
                    is: () => ({
                      select: () => ({
                        maybeSingle: async () => {
                          if (
                            estadoMock.draftRow &&
                            estadoMock.draftRow.status === statusEsperado &&
                            estadoMock.draftRow.linkedin_post_id === null
                          ) {
                            return aplicarUpdate();
                          }
                          return { data: null, error: null };
                        },
                      }),
                    }),
                  });
                },
              };
            },
          }),
        }),
      };
    },
  };
}

describe("executarComBackoff — resiliência em chamadas idempotentes", () => {
  it("recupera após falhas transitórias e retorna o resultado na tentativa bem-sucedida", async () => {
    let chamadas = 0;
    const { resultado, tentativas } = await executarComBackoff(
      async () => {
        chamadas += 1;
        if (chamadas < 3) {
          throw new Error(`Falha transitória #${chamadas}`);
        }
        return "sucesso-na-terceira";
      },
      { maxTentativas: 3, atrasoBaseMs: 1 },
    );

    expect(resultado).toBe("sucesso-na-terceira");
    expect(tentativas).toBe(3);
  });

  it("interrompe imediatamente sem repetir quando deveRepetir retorna false", async () => {
    let chamadas = 0;
    await expect(
      executarComBackoff(
        async () => {
          chamadas += 1;
          throw new Error("HTTP 401 Unauthorized");
        },
        {
          maxTentativas: 4,
          atrasoBaseMs: 1,
          deveRepetir: (err) => !(err instanceof Error && err.message.includes("401")),
        },
      ),
    ).rejects.toThrow("HTTP 401 Unauthorized");
    expect(chamadas).toBe(1);
  });
});

describe("cron.server — autenticação em tempo constante e filtros de janela horária", () => {
  const originalCronSecret = process.env["CRON_SECRET"];

  beforeEach(() => {
    delete process.env["CRON_SECRET"];
    estadoMock.cronSecretBanco = "segredo-cron-super-forte-123";
    estadoMock.settingsRows = [];
  });

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env["CRON_SECRET"];
    else process.env["CRON_SECRET"] = originalCronSecret;
  });

  it("rejeita requisição sem header Authorization Bearer ou com segredo incorreto e aceita o correto", async () => {
    const supabaseAdmin = criarSupabaseAdminCronMock() as never;

    const reqSemHeader = new Request("http://localhost/api/public/coletar", { method: "POST" });
    const resSemHeader = await autenticarRequisicaoCron(reqSemHeader, supabaseAdmin);
    expect(resSemHeader?.status).toBe(401);

    const reqErrada = new Request("http://localhost/api/public/coletar", {
      method: "POST",
      headers: { Authorization: "Bearer segredo-invalido" },
    });
    const resErrada = await autenticarRequisicaoCron(reqErrada, supabaseAdmin);
    expect(resErrada?.status).toBe(401);

    const reqCorreta = new Request("http://localhost/api/public/coletar", {
      method: "POST",
      headers: { Authorization: "Bearer segredo-cron-super-forte-123" },
    });
    const resCorreta = await autenticarRequisicaoCron(reqCorreta, supabaseAdmin);
    expect(resCorreta).toBeNull();
  });

  it("ignora usuários cujo horário agendado ainda não chegou ou que já rodaram hoje", async () => {
    const supabaseAdmin = criarSupabaseAdminCronMock() as never;
    estadoMock.settingsRows = [
      {
        user_id: "user-ja-rodou",
        enabled: true,
        daily_time: "08:00",
        timezone: "America/Bahia",
        last_run_date: "2026-11-26",
      },
      {
        user_id: "user-horario-futuro",
        enabled: true,
        daily_time: "22:00",
        timezone: "America/Bahia",
        last_run_date: null,
      },
    ];

    const coletorSpy = vi.fn();
    // 15:00 UTC = 12:00 em America/Bahia (antes das 22:00)
    const resumo = await executarCicloCron(
      supabaseAdmin,
      new Date("2026-11-26T15:00:00.000Z"),
      coletorSpy as never,
    );

    expect(coletorSpy).not.toHaveBeenCalled();
    expect(resumo.results.every((r) => r.status === "ignorado")).toBe(true);
  });
});

describe("publicarRascunhoAprovadoNoLinkedIn — guardas adversariais de estado e credencial", () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    estadoMock.tokenLinkedIn = "li_token_valido";
    estadoMock.draftRow = {
      id: "draft-1",
      user_id: "user-1",
      content: "Texto técnico aprovado com mais de vinte caracteres para o LinkedIn.",
      status: "aprovado",
      linkedin_post_id: null,
      published_at: null,
    };
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it("bloqueia tentativa de publicar rascunho que ainda está em status 'rascunho' ou 'rejeitado'", async () => {
    const supabase = criarSupabaseMockLinkedIn() as never;
    estadoMock.draftRow!.status = "rascunho";

    await expect(publicarRascunhoAprovadoNoLinkedIn(supabase, "user-1", "draft-1")).rejects.toThrow(
      /Só é possível publicar um post que você aprovou/i,
    );

    estadoMock.draftRow!.status = "rejeitado";
    await expect(publicarRascunhoAprovadoNoLinkedIn(supabase, "user-1", "draft-1")).rejects.toThrow(
      /Só é possível publicar um post que você aprovou/i,
    );
  });

  it("bloqueia publicação quando o usuário não possui conta do LinkedIn conectada", async () => {
    const supabase = criarSupabaseMockLinkedIn() as never;
    estadoMock.tokenLinkedIn = null;

    await expect(publicarRascunhoAprovadoNoLinkedIn(supabase, "user-1", "draft-1")).rejects.toThrow(
      /Nenhuma conta do LinkedIn autorizada/i,
    );
  });

  it("reverte status de 'publicando' para 'aprovado' quando /v2/userinfo retorna HTTP 401", async () => {
    const supabase = criarSupabaseMockLinkedIn() as never;
    globalThis.fetch = vi.fn(async () => new Response("Unauthorized", { status: 401 })) as never;

    await expect(publicarRascunhoAprovadoNoLinkedIn(supabase, "user-1", "draft-1")).rejects.toThrow(
      /A autorização do LinkedIn precisa ser renovada/i,
    );

    // O status deve ter sido revertido para 'aprovado' pois o POST /v2/ugcPosts sequer foi chamado
    expect(estadoMock.draftRow?.status).toBe("aprovado");
  });
});
