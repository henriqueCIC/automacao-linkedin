/**
 * @file observability.server.ts
 * @description Registro estruturado de eventos operacionais e métricas de execução (Etapa 3.4).
 * Garante que nenhum token, chave privada ou segredo seja impresso nos logs do servidor.
 */

import { sanitizarSegredosEmTexto } from "./secret-sanitizer";

export interface EventoOperacional {
  evento:
    | "coleta_iniciada"
    | "coleta_concluida"
    | "coleta_ignorada"
    | "coleta_falhou"
    | "chamada_ia_concluida"
    | "chamada_ia_fallback"
    | "chamada_ia_falhou"
    | "cron_executado";
  runId?: string;
  userId?: string;
  gatilho?: "manual" | "cron";
  status?: string;
  duracaoMs?: number;
  commitsEncontrados?: number;
  repositoriosCount?: number;
  commitsPendentes?: number;
  provedorIA?: "gemini" | "openai";
  modeloIA?: string;
  latenciaIAMs?: number;
  tentativasGitHub?: number;
  mensagem?: string;
}

/**
 * Formata um evento operacional como linha JSON única com sanitização automática de segredos.
 */
export function serializarEventoOperacional(
  dados: EventoOperacional,
  agora: Date = new Date(),
): string {
  const mensagemSegura = dados.mensagem
    ? sanitizarSegredosEmTexto(dados.mensagem).textoSanitizado
    : undefined;

  const registro = {
    timestamp: agora.toISOString(),
    ...dados,
    ...(mensagemSegura !== undefined ? { mensagem: mensagemSegura } : {}),
  };

  return JSON.stringify(registro);
}

/**
 * Emite um evento operacional estruturado para stdout/stderr sem risco de vazar credenciais.
 */
export function registrarEventoOperacional(
  dados: EventoOperacional,
  logger: Pick<Console, "info" | "error"> = console,
): string {
  const linha = serializarEventoOperacional(dados);
  if (dados.evento.endsWith("_falhou") || dados.status === "erro") {
    logger.error(linha);
  } else {
    logger.info(linha);
  }
  return linha;
}

/**
 * Executa uma operação assíncrona idempotente com retentativas limitadas e backoff exponencial.
 * Usado apenas para leituras GET sujeitas a falhas transitórias de rede ou HTTP 502/503/504.
 */
export async function executarComBackoff<T>(
  operacao: (tentativa: number) => Promise<T>,
  opcoes: {
    maxTentativas?: number;
    atrasoBaseMs?: number;
    deveRepetir?: (erro: unknown) => boolean;
  } = {},
): Promise<{ resultado: T; tentativas: number }> {
  const maxTentativas = Math.max(1, opcoes.maxTentativas ?? 3);
  const atrasoBaseMs = Math.max(0, opcoes.atrasoBaseMs ?? 150);
  const deveRepetir = opcoes.deveRepetir ?? (() => true);

  let ultimoErro: unknown;
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa += 1) {
    try {
      const resultado = await operacao(tentativa);
      return { resultado, tentativas: tentativa };
    } catch (erro) {
      ultimoErro = erro;
      if (tentativa >= maxTentativas || !deveRepetir(erro)) {
        throw erro;
      }
      const espera = atrasoBaseMs * 2 ** (tentativa - 1);
      if (espera > 0) {
        await new Promise((resolve) => setTimeout(resolve, espera));
      }
    }
  }

  throw ultimoErro;
}
