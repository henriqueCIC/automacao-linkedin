/**
 * @file ai.server.ts
 * @description Camada confiável de integração com provedores de IA (Google Gemini e OpenAI).
 * Uso exclusivo no servidor; nunca importar no pacote do navegador.
 *
 * Garantias desta camada:
 * 1. Validação de entrada e saída com schemas Zod em tempo de execução (IA01).
 * 2. Timeout explícito por requisição e tratamento estruturado de HTTP 429/5xx/rede (IA02).
 * 3. Fallback automático Gemini -> OpenAI quando ambas as credenciais estiverem presentes.
 * 4. Credenciais enviadas apenas em cabeçalhos HTTP (nunca na URL) e nunca expostas em erros.
 */

import { z } from "zod";
import { registrarEventoOperacional } from "./observability.server";

/** Modelo padrão do Google Gemini conforme documentação oficial atual */
export const MODELO_PADRAO_GEMINI = "gemini-3.5-flash-lite";

/** Modelo padrão da OpenAI com suporte a Structured Outputs (json_schema strict) */
export const MODELO_PADRAO_OPENAI = "gpt-4o-mini";

/** Tempo limite padrão de espera por provedor em milissegundos */
export const TIMEOUT_PADRAO_IA_MS = 30_000;

/** Limites de conteúdo aplicados na entrada e na validação de saída da IA */
export const LIMITES_CONTEUDO_IA = {
  systemMin: 10,
  systemMax: 12_000,
  userMin: 1,
  userMax: 40_000,
  summaryMin: 10,
  summaryMax: 1_500,
  contentMin: 20,
  /** Limite oficial de caracteres de uma publicação de texto no LinkedIn */
  contentMax: 3_000,
} as const;

export type CodigoErroIA =
  | "CHAVE_AUSENTE"
  | "ENTRADA_INVALIDA"
  | "TIMEOUT"
  | "LIMITE_REQUISICOES"
  | "ERRO_HTTP"
  | "ERRO_REDE"
  | "RESPOSTA_INVALIDA"
  | "TODOS_PROVEDORES_FALHARAM";

/** Erro estruturado da camada de IA com código semântico e mensagem amigável em português */
export class ErroCamadaIA extends Error {
  readonly codigo: CodigoErroIA;
  readonly provedor?: "gemini" | "openai" | undefined;

  constructor(codigo: CodigoErroIA, mensagem: string, provedor?: "gemini" | "openai") {
    super(mensagem);
    this.name = "ErroCamadaIA";
    this.codigo = codigo;
    this.provedor = provedor;
  }
}

export const EntradaChamadaIASchema = z.object({
  system: z
    .string()
    .trim()
    .min(
      LIMITES_CONTEUDO_IA.systemMin,
      "Instrução de sistema ausente ou curta demais para chamar a IA.",
    )
    .max(LIMITES_CONTEUDO_IA.systemMax, "Instrução de sistema excedeu o tamanho máximo permitido."),
  user: z
    .string()
    .trim()
    .min(
      LIMITES_CONTEUDO_IA.userMin,
      "Conteúdo do usuário vazio; não há contexto para enviar à IA.",
    )
    .max(LIMITES_CONTEUDO_IA.userMax, "Conteúdo enviado à IA excedeu o tamanho máximo permitido."),
});

export const SaidaRascunhoIASchema = z.object({
  summary: z
    .string()
    .trim()
    .min(LIMITES_CONTEUDO_IA.summaryMin, "Resumo retornado pela IA está vazio ou incompleto.")
    .max(
      LIMITES_CONTEUDO_IA.summaryMax,
      "Resumo retornado pela IA excedeu o limite máximo permitido.",
    ),
  content: z
    .string()
    .trim()
    .min(
      LIMITES_CONTEUDO_IA.contentMin,
      "Conteúdo do post retornado pela IA está vazio ou curto demais.",
    )
    .max(
      LIMITES_CONTEUDO_IA.contentMax,
      "Conteúdo do post retornado pela IA excedeu o limite de 3000 caracteres do LinkedIn.",
    ),
});

export type AiDraft = z.infer<typeof SaidaRascunhoIASchema>;

interface UsoTokensIA {
  tokensEntradaIA: number;
  tokensSaidaIA: number;
  tokensCacheIA: number;
  tokensRaciocinioIA: number;
  tokensTotalIA: number;
}

interface RespostaProvedorIA {
  rascunho: AiDraft;
  uso: UsoTokensIA;
}

function normalizarTokens(valor: unknown): number {
  return Number.isFinite(Number(valor)) && Number(valor) > 0 ? Math.trunc(Number(valor)) : 0;
}

export interface OpcoesChamadaIA {
  /** Sobrescreve o tempo limite da chamada HTTP em milissegundos */
  timeoutMs?: number;
}

/** Resolve o tempo limite em milissegundos validando override ou variável de ambiente */
function resolverTimeoutMs(opcoes?: OpcoesChamadaIA): number {
  if (
    opcoes?.timeoutMs !== undefined &&
    Number.isFinite(opcoes.timeoutMs) &&
    opcoes.timeoutMs > 0
  ) {
    return Math.floor(opcoes.timeoutMs);
  }
  const envRaw = process.env["AI_TIMEOUT_MS"];
  if (envRaw) {
    const parsed = Number(envRaw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return TIMEOUT_PADRAO_IA_MS;
}

/** Detecta erros de cancelamento por tempo limite gerados por AbortSignal.timeout / AbortController */
function ehErroDeTimeout(erro: unknown): boolean {
  if (!(erro instanceof Error)) return false;
  return (
    erro.name === "TimeoutError" ||
    erro.name === "AbortError" ||
    /timeout|aborted/i.test(erro.message)
  );
}

/**
 * Faz parse estrito de JSON e valida o objeto resultante com Zod.
 * Garante que nenhuma resposta vazia, malformada ou fora dos limites passe para o banco/UI.
 */
function validarSaidaTextoJson(textoBruto: string, provedor: "gemini" | "openai"): AiDraft {
  const textoLimpo = textoBruto.trim();
  if (!textoLimpo) {
    throw new ErroCamadaIA(
      "RESPOSTA_INVALIDA",
      `A IA (${provedor}) retornou uma resposta vazia.`,
      provedor,
    );
  }

  let objetoBruto: unknown;
  try {
    objetoBruto = JSON.parse(textoLimpo);
  } catch {
    throw new ErroCamadaIA(
      "RESPOSTA_INVALIDA",
      `A IA (${provedor}) retornou JSON inválido e o rascunho foi descartado por segurança.`,
      provedor,
    );
  }

  const validacao = SaidaRascunhoIASchema.safeParse(objetoBruto);
  if (!validacao.success) {
    const detalhes = validacao.error.issues.map((issue) => issue.message).join(" ");
    throw new ErroCamadaIA(
      "RESPOSTA_INVALIDA",
      `A resposta da IA (${provedor}) não atendeu ao formato esperado: ${detalhes}`,
      provedor,
    );
  }

  return validacao.data;
}

/** Executa chamada estruturada ao Google Gemini usando cabeçalho x-goog-api-key */
async function chamarGemini(
  apiKey: string,
  system: string,
  user: string,
  timeoutMs: number,
): Promise<RespostaProvedorIA> {
  const modelo = process.env["GEMINI_MODEL"]?.trim() || MODELO_PADRAO_GEMINI;
  const baseUrl =
    process.env["GEMINI_API_BASE_URL"]?.trim() || "https://generativelanguage.googleapis.com";
  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              summary: { type: "STRING" },
              content: { type: "STRING" },
            },
            required: ["summary", "content"],
          },
        },
      }),
    });
  } catch (erro) {
    if (ehErroDeTimeout(erro)) {
      throw new ErroCamadaIA(
        "TIMEOUT",
        `A API do Gemini excedeu o tempo limite de ${Math.round(timeoutMs / 1000)}s.`,
        "gemini",
      );
    }
    throw new ErroCamadaIA(
      "ERRO_REDE",
      "Falha de conexão ao contatar a API do Gemini. Tente novamente em instantes.",
      "gemini",
    );
  }

  if (!res.ok) {
    console.error(`Erro na API do Gemini [HTTP ${res.status}]`);
    if (res.status === 429) {
      throw new ErroCamadaIA(
        "LIMITE_REQUISICOES",
        "Limite de requisições da IA atingido no Gemini. Tente novamente em instantes.",
        "gemini",
      );
    }
    throw new ErroCamadaIA(
      "ERRO_HTTP",
      `Falha na API do Gemini (HTTP ${res.status}). Verifique o modelo e a GEMINI_API_KEY.`,
      "gemini",
    );
  }

  let payload: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      cachedContentTokenCount?: number;
      thoughtsTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  try {
    payload = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
        thoughtsTokenCount?: number;
        totalTokenCount?: number;
      };
    };
  } catch {
    throw new ErroCamadaIA(
      "RESPOSTA_INVALIDA",
      "A resposta HTTP do Gemini não contém um envelope JSON válido.",
      "gemini",
    );
  }

  const textoBruto = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const meta = payload.usageMetadata;
  return {
    rascunho: validarSaidaTextoJson(textoBruto, "gemini"),
    uso: {
      tokensEntradaIA: normalizarTokens(meta?.promptTokenCount),
      tokensSaidaIA: normalizarTokens(meta?.candidatesTokenCount),
      tokensCacheIA: normalizarTokens(meta?.cachedContentTokenCount),
      tokensRaciocinioIA: normalizarTokens(meta?.thoughtsTokenCount),
      tokensTotalIA: normalizarTokens(meta?.totalTokenCount),
    },
  };
}

/** Executa chamada estruturada à OpenAI usando json_schema strict */
async function chamarOpenAi(
  apiKey: string,
  system: string,
  user: string,
  timeoutMs: number,
): Promise<RespostaProvedorIA> {
  const modelo = process.env["OPENAI_MODEL"]?.trim() || MODELO_PADRAO_OPENAI;
  const url =
    process.env["OPENAI_BASE_URL"]?.trim() || "https://api.openai.com/v1/chat/completions";

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: modelo,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "linkedin_draft",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                summary: { type: "string" },
                content: { type: "string" },
              },
              required: ["summary", "content"],
            },
          },
        },
      }),
    });
  } catch (erro) {
    if (ehErroDeTimeout(erro)) {
      throw new ErroCamadaIA(
        "TIMEOUT",
        `A API da OpenAI excedeu o tempo limite de ${Math.round(timeoutMs / 1000)}s.`,
        "openai",
      );
    }
    throw new ErroCamadaIA(
      "ERRO_REDE",
      "Falha de conexão ao contatar a API da OpenAI. Tente novamente em instantes.",
      "openai",
    );
  }

  if (!res.ok) {
    console.error(`Erro na API da OpenAI [HTTP ${res.status}]`);
    if (res.status === 429) {
      throw new ErroCamadaIA(
        "LIMITE_REQUISICOES",
        "Limite de requisições da IA atingido na OpenAI. Tente novamente em instantes.",
        "openai",
      );
    }
    throw new ErroCamadaIA(
      "ERRO_HTTP",
      `Falha na API da OpenAI (HTTP ${res.status}). Verifique o modelo e a OPENAI_API_KEY.`,
      "openai",
    );
  }

  let payload: {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    throw new ErroCamadaIA(
      "RESPOSTA_INVALIDA",
      "A resposta HTTP da OpenAI não contém um envelope JSON válido.",
      "openai",
    );
  }

  const textoBruto = payload.choices?.[0]?.message?.content ?? "";
  const usage = payload.usage;
  return {
    rascunho: validarSaidaTextoJson(textoBruto, "openai"),
    uso: {
      tokensEntradaIA: normalizarTokens(usage?.prompt_tokens),
      tokensSaidaIA: normalizarTokens(usage?.completion_tokens),
      tokensCacheIA: normalizarTokens(usage?.prompt_tokens_details?.cached_tokens),
      tokensRaciocinioIA: normalizarTokens(usage?.completion_tokens_details?.reasoning_tokens),
      tokensTotalIA: normalizarTokens(usage?.total_tokens),
    },
  };
}

/**
 * Invoca a camada de IA com validação estrita de entrada e saída, timeout explícito
 * e fallback automático Gemini -> OpenAI quando ambos os provedores estiverem configurados.
 */
export async function callAi(
  system: string,
  user: string,
  opcoes?: OpcoesChamadaIA,
): Promise<AiDraft> {
  const entradaValidada = EntradaChamadaIASchema.safeParse({ system, user });
  if (!entradaValidada.success) {
    const detalhes = entradaValidada.error.issues.map((issue) => issue.message).join(" ");
    throw new ErroCamadaIA("ENTRADA_INVALIDA", `Entrada inválida para a IA: ${detalhes}`);
  }

  const geminiKey = (process.env["GEMINI_API_KEY"] || process.env["GOOGLE_API_KEY"])?.trim();
  const openaiKey = process.env["OPENAI_API_KEY"]?.trim();

  if (!geminiKey && !openaiKey) {
    throw new ErroCamadaIA(
      "CHAVE_AUSENTE",
      "Nenhuma chave de IA configurada. Defina GEMINI_API_KEY ou OPENAI_API_KEY no arquivo .env.",
    );
  }

  const timeoutMs = resolverTimeoutMs(opcoes);
  const { system: systemSeguro, user: userSeguro } = entradaValidada.data;

  // 1. Provedor primário: Google Gemini (com fallback automático para OpenAI se configurada)
  if (geminiKey) {
    const modeloGemini = process.env["GEMINI_MODEL"]?.trim() || MODELO_PADRAO_GEMINI;
    const inicioGemini = Date.now();
    try {
      const resposta = await chamarGemini(geminiKey, systemSeguro, userSeguro, timeoutMs);
      registrarEventoOperacional({
        evento: "chamada_ia_concluida",
        provedorIA: "gemini",
        modeloIA: modeloGemini,
        latenciaIAMs: Date.now() - inicioGemini,
        status: "ok",
        ...resposta.uso,
      });
      return resposta.rascunho;
    } catch (erroGemini) {
      const motivoGemini =
        erroGemini instanceof Error ? erroGemini.message : "Erro desconhecido no Gemini.";

      if (!openaiKey) {
        registrarEventoOperacional({
          evento: "chamada_ia_falhou",
          provedorIA: "gemini",
          modeloIA: modeloGemini,
          latenciaIAMs: Date.now() - inicioGemini,
          status: "erro",
          mensagem: motivoGemini,
        });
        throw erroGemini;
      }

      console.warn(`Fallback de IA acionado (Gemini -> OpenAI): ${motivoGemini}`);
      registrarEventoOperacional({
        evento: "chamada_ia_fallback",
        provedorIA: "gemini",
        modeloIA: modeloGemini,
        latenciaIAMs: Date.now() - inicioGemini,
        status: "fallback",
        mensagem: motivoGemini,
      });

      const modeloOpenAi = process.env["OPENAI_MODEL"]?.trim() || MODELO_PADRAO_OPENAI;
      const inicioOpenAi = Date.now();
      try {
        const respostaFallback = await chamarOpenAi(openaiKey, systemSeguro, userSeguro, timeoutMs);
        registrarEventoOperacional({
          evento: "chamada_ia_concluida",
          provedorIA: "openai",
          modeloIA: modeloOpenAi,
          latenciaIAMs: Date.now() - inicioOpenAi,
          status: "ok_fallback",
          ...respostaFallback.uso,
        });
        return respostaFallback.rascunho;
      } catch (erroOpenAi) {
        const motivoOpenAi =
          erroOpenAi instanceof Error ? erroOpenAi.message : "Erro desconhecido na OpenAI.";
        registrarEventoOperacional({
          evento: "chamada_ia_falhou",
          provedorIA: "openai",
          modeloIA: modeloOpenAi,
          latenciaIAMs: Date.now() - inicioOpenAi,
          status: "erro",
          mensagem: motivoOpenAi,
        });
        throw new ErroCamadaIA(
          "TODOS_PROVEDORES_FALHARAM",
          `Falha nos dois provedores de IA. Gemini: ${motivoGemini} | OpenAI: ${motivoOpenAi}`,
        );
      }
    }
  }

  // 2. Provedor alternativo direto quando apenas OpenAI está configurada
  const modeloOpenAi = process.env["OPENAI_MODEL"]?.trim() || MODELO_PADRAO_OPENAI;
  const inicioOpenAi = Date.now();
  try {
    const resposta = await chamarOpenAi(openaiKey!, systemSeguro, userSeguro, timeoutMs);
    registrarEventoOperacional({
      evento: "chamada_ia_concluida",
      provedorIA: "openai",
      modeloIA: modeloOpenAi,
      latenciaIAMs: Date.now() - inicioOpenAi,
      status: "ok",
      ...resposta.uso,
    });
    return resposta.rascunho;
  } catch (erroOpenAi) {
    registrarEventoOperacional({
      evento: "chamada_ia_falhou",
      provedorIA: "openai",
      modeloIA: modeloOpenAi,
      latenciaIAMs: Date.now() - inicioOpenAi,
      status: "erro",
      mensagem: erroOpenAi instanceof Error ? erroOpenAi.message : "Erro desconhecido na OpenAI.",
    });
    throw erroOpenAi;
  }
}
