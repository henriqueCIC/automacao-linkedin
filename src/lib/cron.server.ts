/**
 * @file cron.server.ts
 * @description Autenticação em tempo constante e execução segura da rotina agendada de coleta (A01, A02).
 * Garante que 'last_run_date' só seja gravado após coleta concluída com 'status === "ok"',
 * permitindo recuperação automática caso ocorra erro transitório.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { collectForUser } from "./collect.server";
import { registrarEventoOperacional } from "./observability.server";
import { deveExecutarColetaAgendada, partesDataHoraNoFuso } from "./timezone";

function compararSegredoEmTempoConstante(fornecido: string, esperado: string): boolean {
  const digest = (valor: string) => createHash("sha256").update(valor, "utf8").digest();
  return timingSafeEqual(digest(fornecido), digest(esperado));
}

/**
 * Autentica requisições ao endpoint público do cron via Bearer token.
 * Prioriza CRON_SECRET do ambiente quando configurado; caso contrário, consulta 'cron_secrets' (id = 1).
 */
export async function autenticarRequisicaoCron(
  request: Request,
  supabaseAdmin?: SupabaseClient<Database>,
): Promise<Response | null> {
  const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
  const tokenFornecido = match?.[1];
  if (!tokenFornecido) {
    return new Response("Unauthorized", { status: 401 });
  }

  const segredoEnv = process.env["CRON_SECRET"]?.trim();
  if (segredoEnv) {
    if (!compararSegredoEmTempoConstante(tokenFornecido, segredoEnv)) {
      return new Response("Unauthorized", { status: 401 });
    }
    return null;
  }

  if (!supabaseAdmin) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("cron_secrets")
    .select("secret")
    .eq("id", 1)
    .single();

  if (error || !data?.secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!compararSegredoEmTempoConstante(tokenFornecido, data.secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}

export interface ResultadoUsuarioCron {
  userId: string;
  status: string;
  commitsFound?: number;
  repositories?: string[];
  message?: string | null;
}

/**
 * Executa o ciclo de verificação e coleta agendada para todos os usuários habilitados.
 * Regra crítica (A01): `last_run_date` só avança quando `result.status === "ok"`.
 */
export async function executarCicloCron(
  supabaseAdmin: SupabaseClient<Database>,
  agora: Date = new Date(),
  coletor: typeof collectForUser = collectForUser,
): Promise<{
  success: true;
  processed: number;
  at: string;
  results: ResultadoUsuarioCron[];
}> {
  const inicioMs = Date.now();
  const { data: settingsRows, error: settingsError } = await supabaseAdmin
    .from("automation_settings")
    .select("user_id, daily_time, timezone, enabled, last_run_date")
    .eq("enabled", true);

  if (settingsError) {
    throw new Error(`Falha ao carregar configurações do cron: ${settingsError.message}`);
  }

  const results: ResultadoUsuarioCron[] = [];

  for (const settings of settingsRows ?? []) {
    const elegivel = deveExecutarColetaAgendada({
      horarioDiario: settings.daily_time,
      fusoHorario: settings.timezone,
      ultimaDataSucesso: settings.last_run_date,
      agora,
    });

    if (!elegivel) {
      results.push({
        userId: settings.user_id,
        status: "ignorado",
        message: "fora do horário ou já concluído hoje",
      });
      continue;
    }

    try {
      const result = await coletor(supabaseAdmin, settings.user_id, "cron");

      // A01: Só marca o dia como concluído quando a coleta efetivamente teve sucesso ("ok")
      if (result.status === "ok") {
        const { data: dataHojeNoFuso } = partesDataHoraNoFuso(settings.timezone, agora);
        const { error: erroUpdateData } = await supabaseAdmin
          .from("automation_settings")
          .update({ last_run_date: dataHojeNoFuso })
          .eq("user_id", settings.user_id);

        if (erroUpdateData) {
          console.error("Falha ao atualizar last_run_date no cron:", erroUpdateData.message);
        }
      }

      results.push({
        userId: settings.user_id,
        status: result.status,
        commitsFound: result.commitsFound,
        repositories: result.repositories,
        message: result.message ?? null,
      });
    } catch (erro: unknown) {
      const message = erro instanceof Error ? erro.message : String(erro);
      results.push({ userId: settings.user_id, status: "erro", message });
    }
  }

  registrarEventoOperacional({
    evento: "cron_executado",
    gatilho: "cron",
    status: "ok",
    duracaoMs: Date.now() - inicioMs,
    mensagem: `Processados ${results.length} usuário(s) no ciclo agendado.`,
  });

  return {
    success: true,
    processed: results.length,
    at: agora.toISOString(),
    results,
  };
}
