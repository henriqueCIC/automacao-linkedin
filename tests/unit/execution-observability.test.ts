/**
 * @file execution-observability.test.ts
 * @description Testes unitários e de integração simulada para as Subetapas 3.3 e 3.4:
 * - A02: validação de fusos horários IANA, migração de 'America/Rio_de_Janeiro' e datas determinísticas.
 * - A01: cron não grava 'last_run_date' quando a coleta falha ou é ignorada, permitindo retentativa.
 * - Backoff limitado para falhas transitórias e logs estruturados livres de segredos.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  FUSOS_HORARIOS_SUPORTADOS,
  FUSO_HORARIO_PADRAO,
  calcularJanela24HorasAtras,
  deveExecutarColetaAgendada,
  ehFusoHorarioValido,
  normalizarFusoHorario,
  partesDataHoraNoFuso,
} from "@/lib/timezone";
import {
  executarComBackoff,
  registrarEventoOperacional,
  serializarEventoOperacional,
} from "@/lib/observability.server";
import { autenticarRequisicaoCron, executarCicloCron } from "@/lib/cron.server";

describe("A02 — Fusos horários IANA e cálculos determinísticos", () => {
  it("valida todos os fusos suportados e rejeita America/Rio_de_Janeiro puro como IANA inválido", () => {
    for (const tz of FUSOS_HORARIOS_SUPORTADOS) {
      expect(ehFusoHorarioValido(tz), `${tz} deve ser IANA válido`).toBe(true);
    }
    expect(ehFusoHorarioValido("America/Rio_de_Janeiro")).toBe(false);
    expect(ehFusoHorarioValido("Fuso/Inexistente")).toBe(false);
  });

  it("normaliza America/Rio_de_Janeiro legado para America/Sao_Paulo e faz fallback seguro em inválidos", () => {
    expect(normalizarFusoHorario("America/Rio_de_Janeiro")).toBe("America/Sao_Paulo");
    expect(normalizarFusoHorario("Fuso/Quebrado")).toBe(FUSO_HORARIO_PADRAO);
    expect(normalizarFusoHorario("")).toBe(FUSO_HORARIO_PADRAO);
  });

  it("calcula janela de 24h atrás e decisão de agendamento de forma determinística", () => {
    const referencia = new Date("2026-11-23T21:30:00.000Z"); // 18:30 em America/Bahia (UTC-3)
    expect(calcularJanela24HorasAtras(referencia)).toBe("2026-11-22T21:30:00.000Z");

    const partes = partesDataHoraNoFuso("America/Bahia", referencia);
    expect(partes.data).toBe("2026-11-23");
    expect(partes.hora).toBe("18:30");

    // Deve rodar às 18:30 quando agendado para 18:00 e ainda não rodou hoje
    expect(
      deveExecutarColetaAgendada({
        horarioDiario: "18:00",
        fusoHorario: "America/Bahia",
        ultimaDataSucesso: "2026-11-22",
        agora: referencia,
      }),
    ).toBe(true);

    // Não deve rodar se já concluiu com sucesso na data de hoje
    expect(
      deveExecutarColetaAgendada({
        horarioDiario: "18:00",
        fusoHorario: "America/Bahia",
        ultimaDataSucesso: "2026-11-23",
        agora: referencia,
      }),
    ).toBe(false);

    // Mesmo que o banco contenha legado America/Rio_de_Janeiro, não lança RangeError
    expect(() =>
      deveExecutarColetaAgendada({
        horarioDiario: "18:00",
        fusoHorario: "America/Rio_de_Janeiro",
        ultimaDataSucesso: null,
        agora: referencia,
      }),
    ).not.toThrow();
  });
});

describe("A01 — Execução segura do Cron sem bloquear dia em caso de erro", () => {
  const backupCronSecret = process.env["CRON_SECRET"];

  afterEach(() => {
    if (backupCronSecret === undefined) {
      delete process.env["CRON_SECRET"];
    } else {
      process.env["CRON_SECRET"] = backupCronSecret;
    }
  });

  it("autentica Bearer token em tempo constante e rejeita tokens ausentes ou incorretos", async () => {
    process.env["CRON_SECRET"] = "segredo-cron-forte-123";

    const reqSemToken = new Request("http://localhost/api/public/coletar", { method: "POST" });
    expect((await autenticarRequisicaoCron(reqSemToken))?.status).toBe(401);

    const reqErrada = new Request("http://localhost/api/public/coletar", {
      method: "POST",
      headers: { Authorization: "Bearer token-errado" },
    });
    expect((await autenticarRequisicaoCron(reqErrada))?.status).toBe(401);

    const reqCorreta = new Request("http://localhost/api/public/coletar", {
      method: "POST",
      headers: { Authorization: "Bearer segredo-cron-forte-123" },
    });
    expect(await autenticarRequisicaoCron(reqCorreta)).toBeNull();
  });

  it("atualiza last_run_date apenas para usuários cujo coletor retornou status 'ok'", async () => {
    const usuariosAtualizados: Array<{ userId: string; last_run_date: string }> = [];

    const supabaseMock = {
      from(tabela: string) {
        if (tabela !== "automation_settings") throw new Error(`Tabela inesperada: ${tabela}`);
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [
                    {
                      user_id: "user-falha",
                      daily_time: "18:00",
                      timezone: "America/Bahia",
                      enabled: true,
                      last_run_date: null,
                    },
                    {
                      user_id: "user-sucesso",
                      daily_time: "18:00",
                      timezone: "America/Bahia",
                      enabled: true,
                      last_run_date: null,
                    },
                  ],
                  error: null,
                });
              },
            };
          },
          update(valores: { last_run_date: string }) {
            return {
              eq(_col: string, userId: string) {
                usuariosAtualizados.push({ userId, last_run_date: valores.last_run_date });
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    } as unknown as SupabaseClient<Database>;

    const coletorSimulado = vi
      .fn()
      .mockResolvedValueOnce({
        runId: "r1",
        status: "erro",
        commitsFound: 0,
        repositories: [],
        message: "Falha temporária na IA",
      })
      .mockResolvedValueOnce({
        runId: "r2",
        status: "ok",
        commitsFound: 2,
        repositories: ["dev/repo"],
        message: "Rascunho gerado",
      });

    const referencia = new Date("2026-11-23T21:30:00.000Z"); // 18:30 America/Bahia
    const resposta = await executarCicloCron(supabaseMock, referencia, coletorSimulado);

    expect(resposta.processed).toBe(2);
    // Apenas 'user-sucesso' deve ter last_run_date marcado; 'user-falha' permanece elegível para retentativa!
    expect(usuariosAtualizados).toEqual([{ userId: "user-sucesso", last_run_date: "2026-11-23" }]);
  });
});

describe("Subetapa 3.4 — Backoff controlado e observabilidade sem vazamento de segredos", () => {
  it("repete operação transitória até ter sucesso respeitando limite de tentativas", async () => {
    let chamadas = 0;
    const { resultado, tentativas } = await executarComBackoff(
      async () => {
        chamadas += 1;
        if (chamadas < 2) throw new Error("HTTP 503 temporário");
        return "dados-ok";
      },
      { maxTentativas: 3, atrasoBaseMs: 1 },
    );

    expect(resultado).toBe("dados-ok");
    expect(tentativas).toBe(2);
  });

  it("serializa eventos estruturados mascarando automaticamente qualquer token presente na mensagem", () => {
    const loggerFalso = { info: vi.fn(), error: vi.fn() };
    const linha = registrarEventoOperacional(
      {
        evento: "coleta_falhou",
        runId: "run-99",
        userId: "user-1",
        status: "erro",
        duracaoMs: 142,
        mensagem:
          "Falha com token ghp_1234567890abcdefghijklmnopqrstuv e sk-proj-1234567890abcdefghij",
      },
      loggerFalso,
    );

    expect(loggerFalso.error).toHaveBeenCalledTimes(1);
    expect(linha).not.toContain("ghp_1234567890");
    expect(linha).not.toContain("sk-proj-123456");

    const obj = JSON.parse(linha) as { runId: string; duracaoMs: number; mensagem: string };
    expect(obj.runId).toBe("run-99");
    expect(obj.duracaoMs).toBe(142);
    expect(obj.mensagem).toContain("[SEGREDO_MASCARADO]");
  });
});
