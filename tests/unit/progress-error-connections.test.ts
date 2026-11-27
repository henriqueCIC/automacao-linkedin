/**
 * @file progress-error-connections.test.ts
 * @description Testes unitários exaustivos para:
 * - `src/lib/collection-progress.ts` (máquina de estados de progresso da coleta)
 * - `src/lib/error-capture.ts` e `src/lib/error-page.ts` (captura de erros SSR, cadeia de causas, TTL e HTML 500)
 * - `src/lib/appUserConnections.server.ts` (CRUD criptografado de credenciais OAuth por usuário e propagação de falhas)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLLECTION_STEPS, isCollectionRunning } from "@/lib/collection-progress";
import { consumeLastCapturedError, describeError } from "@/lib/error-capture";
import { renderErrorPage } from "@/lib/error-page";
import { decryptConnectionKey, encryptConnectionKey } from "@/lib/connectionKeyCrypto.server";

const CHAVE_32B_VALIDA = Buffer.alloc(32, 11).toString("base64");

interface MockConnectionRow {
  user_id: string;
  connector_id: string;
  connection_key_ciphertext: string;
  account_login: string | null;
  reconnect_required: boolean;
  updated_at?: string;
}

const estadoConexoes: {
  rows: MockConnectionRow[];
  forcedError: { message: string } | null;
} = {
  rows: [],
  forcedError: null,
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table !== "app_user_connections") {
        throw new Error(`Tabela inesperada no mock: ${table}`);
      }
      return {
        upsert: async (payload: MockConnectionRow) => {
          if (estadoConexoes.forcedError) return { error: estadoConexoes.forcedError };
          const idx = estadoConexoes.rows.findIndex(
            (r) => r.user_id === payload.user_id && r.connector_id === payload.connector_id,
          );
          if (idx >= 0) {
            estadoConexoes.rows[idx] = { ...estadoConexoes.rows[idx]!, ...payload };
          } else {
            estadoConexoes.rows.push({ ...payload });
          }
          return { error: null };
        },
        select: () => ({
          eq: (_col1: string, userId: string) => ({
            eq: (_col2: string, connectorId: string) => ({
              maybeSingle: async () => {
                if (estadoConexoes.forcedError) {
                  return { data: null, error: estadoConexoes.forcedError };
                }
                const found =
                  estadoConexoes.rows.find(
                    (r) => r.user_id === userId && r.connector_id === connectorId,
                  ) ?? null;
                return { data: found, error: null };
              },
            }),
          }),
        }),
        update: (patch: Partial<MockConnectionRow>) => ({
          eq: (_col1: string, userId: string) => ({
            eq: async (_col2: string, connectorId: string) => {
              if (estadoConexoes.forcedError) return { error: estadoConexoes.forcedError };
              for (const row of estadoConexoes.rows) {
                if (row.user_id === userId && row.connector_id === connectorId) {
                  Object.assign(row, patch);
                }
              }
              return { error: null };
            },
          }),
        }),
        delete: () => ({
          eq: (_col1: string, userId: string) => ({
            eq: async (_col2: string, connectorId: string) => {
              if (estadoConexoes.forcedError) return { error: estadoConexoes.forcedError };
              estadoConexoes.rows = estadoConexoes.rows.filter(
                (r) => !(r.user_id === userId && r.connector_id === connectorId),
              );
              return { error: null };
            },
          }),
        }),
      };
    },
  },
}));

describe("collection-progress — máquina de estados de progresso da coleta", () => {
  it("reconhece todas as 6 etapas ativas como em execução", () => {
    expect(COLLECTION_STEPS).toHaveLength(6);
    for (const step of COLLECTION_STEPS) {
      expect(isCollectionRunning(step.status)).toBe(true);
      expect(step.label.length).toBeGreaterThan(3);
    }
  });

  it("retorna false para estados terminais, vazios ou desconhecidos", () => {
    for (const terminal of ["ok", "erro", "ignorado", "", "concluido", "pendente"]) {
      expect(isCollectionRunning(terminal)).toBe(false);
    }
  });
});

describe("error-capture e error-page — captura de erros SSR e página 500", () => {
  afterEach(() => {
    vi.useRealTimers();
    consumeLastCapturedError();
  });

  it("expande cadeia de causas (cause chain) e inclui código de status HTTP quando presente", () => {
    const causaRaiz = Object.assign(new Error("Conexão recusada no banco"), { statusCode: 503 });
    const erroIntermediario = new Error("Falha ao carregar sessão", { cause: causaRaiz });
    const erroTopo = Object.assign(
      new Error("Erro interno no handler SSR", { cause: erroIntermediario }),
      {
        status: 500,
      },
    );

    const descricao = describeError(erroTopo);

    expect(descricao).toContain("Erro interno no handler SSR");
    expect(descricao).toContain("(status 500)");
    expect(descricao).toContain("caused by:");
    expect(descricao).toContain("Falha ao carregar sessão");
    expect(descricao).toContain("Conexão recusada no banco");
    expect(descricao).toContain("(status 503)");
  });

  it("serializa valores não-Error e objetos circulares sem lançar exceção", () => {
    expect(describeError("erro em texto simples")).toBe("erro em texto simples");
    expect(describeError({ codigo: "E_TIMEOUT" })).toBe('{"codigo":"E_TIMEOUT"}');

    const circular: Record<string, unknown> = { nome: "ciclo" };
    circular["self"] = circular;
    expect(describeError(circular)).toBe("[object Object]");
  });

  it("captura erro via console.error, consome apenas uma vez e expira após o TTL de 5s", () => {
    vi.useFakeTimers();
    const erroCapturado = new Error("Falha simulada no SSR");
    console.error(erroCapturado);

    expect(consumeLastCapturedError()).toBe(erroCapturado);
    // Segunda chamada deve retornar undefined (consumo único)
    expect(consumeLastCapturedError()).toBeUndefined();

    // Testa expiração por TTL (> 5000ms)
    const erroExpirado = new Error("Erro antigo");
    console.error(erroExpirado);
    vi.advanceTimersByTime(6_000);
    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("renderiza página HTML 500 acessível em português brasileiro", () => {
    const html = renderErrorPage();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain("Não foi possível carregar esta página");
    expect(html).toContain("Tentar novamente");
    expect(html).toContain('href="/"');
  });
});

describe("appUserConnections.server — CRUD criptografado de credenciais OAuth por usuário", () => {
  const originalSecret = process.env["ENCRYPTION_SECRET"];

  beforeEach(() => {
    process.env["ENCRYPTION_SECRET"] = CHAVE_32B_VALIDA;
    estadoConexoes.rows = [];
    estadoConexoes.forcedError = null;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env["ENCRYPTION_SECRET"];
    else process.env["ENCRYPTION_SECRET"] = originalSecret;
  });

  it("salva token criptografado com AES-256-GCM, recupera descriptografado, atualiza login/reconexão e remove", async () => {
    const {
      saveConnectionKeyForUser,
      getConnectionForUser,
      getConnectionKeyForUser,
      markReconnectRequired,
      saveAccountLogin,
      deleteConnectionForUser,
      GITHUB_CONNECTOR_ID,
    } = await import("@/lib/appUserConnections.server");

    await saveConnectionKeyForUser(
      "user-qa-1",
      GITHUB_CONNECTOR_ID,
      "gho_token_secreto_123",
      "henriqueCIC",
    );

    // Verifica que no banco o valor armazenado é ciphertext (nunca texto puro)
    expect(estadoConexoes.rows).toHaveLength(1);
    expect(estadoConexoes.rows[0]!.connection_key_ciphertext).not.toContain(
      "gho_token_secreto_123",
    );
    expect(decryptConnectionKey(estadoConexoes.rows[0]!.connection_key_ciphertext)).toBe(
      "gho_token_secreto_123",
    );

    const conn = await getConnectionForUser("user-qa-1", GITHUB_CONNECTOR_ID);
    expect(conn).toEqual({
      connectionAPIKey: "gho_token_secreto_123",
      accountLogin: "henriqueCIC",
      reconnectRequired: false,
    });

    expect(await getConnectionKeyForUser("user-qa-1", GITHUB_CONNECTOR_ID)).toBe(
      "gho_token_secreto_123",
    );
    expect(await getConnectionKeyForUser("outro-user", GITHUB_CONNECTOR_ID)).toBeNull();

    await markReconnectRequired("user-qa-1", GITHUB_CONNECTOR_ID);
    expect((await getConnectionForUser("user-qa-1", GITHUB_CONNECTOR_ID))?.reconnectRequired).toBe(
      true,
    );

    await saveAccountLogin("user-qa-1", GITHUB_CONNECTOR_ID, "henrique-novo-login");
    expect((await getConnectionForUser("user-qa-1", GITHUB_CONNECTOR_ID))?.accountLogin).toBe(
      "henrique-novo-login",
    );

    await deleteConnectionForUser("user-qa-1", GITHUB_CONNECTOR_ID);
    expect(await getConnectionForUser("user-qa-1", GITHUB_CONNECTOR_ID)).toBeNull();
  });

  it("propaga erros de banco em todas as operações de appUserConnections", async () => {
    const {
      saveConnectionKeyForUser,
      getConnectionForUser,
      markReconnectRequired,
      saveAccountLogin,
      deleteConnectionForUser,
    } = await import("@/lib/appUserConnections.server");

    estadoConexoes.forcedError = { message: "Falha de escrita no Postgres" };

    await expect(saveConnectionKeyForUser("u1", "github", "tok")).rejects.toEqual({
      message: "Falha de escrita no Postgres",
    });
    await expect(getConnectionForUser("u1", "github")).rejects.toEqual({
      message: "Falha de escrita no Postgres",
    });
    await expect(markReconnectRequired("u1", "github")).rejects.toEqual({
      message: "Falha de escrita no Postgres",
    });
    await expect(saveAccountLogin("u1", "github", "login")).rejects.toEqual({
      message: "Falha de escrita no Postgres",
    });
    await expect(deleteConnectionForUser("u1", "github")).rejects.toEqual({
      message: "Falha de escrita no Postgres",
    });
  });

  it("gera ciphertexts distintos com IV aleatório para a mesma chave de conexão", () => {
    const c1 = encryptConnectionKey("mesmo-token-oauth");
    const c2 = encryptConnectionKey("mesmo-token-oauth");
    expect(c1).not.toBe(c2);
    expect(decryptConnectionKey(c1)).toBe("mesmo-token-oauth");
    expect(decryptConnectionKey(c2)).toBe("mesmo-token-oauth");
  });
});
