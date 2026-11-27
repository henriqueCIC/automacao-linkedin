/**
 * @file ai.server.test.ts
 * @description Testes de integração da camada de IA (src/lib/ai.server.ts) com respostas HTTP
 * simuladas e zero cobrança de APIs externas.
 * Valida schemas de entrada/saída (IA01), timeout, rate limit, falhas HTTP e fallback
 * automático Gemini -> OpenAI (IA02), além de proteção contra vazamento de chaves.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAi } from "@/lib/ai.server";

const CHAVES_ENV_IA = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_BASE_URL",
  "AI_TIMEOUT_MS",
] as const;

const SYSTEM_VALIDO = "Você é um redator técnico em português do Brasil que devolve JSON válido.";
const USER_VALIDO = "Commit: feat: adiciona validação de schema na camada de IA.";

const RASCUNHO_VALIDO = {
  summary: "Implementada validação de schemas Zod e testes integrados na camada de IA.",
  content:
    "Hoje blindei a integração de IA da nossa automação com validação de saída em tempo de execução, timeout explícito e fallback automático entre provedores. Assim nenhuma resposta malformada chega ao banco de dados.",
};

function respostaGeminiValida(textoJson: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: textoJson }] } }],
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function respostaOpenAiValida(textoJson: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: textoJson } }],
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

describe("callAi — camada de IA confiável (integração simulada)", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const backupEnv: Partial<Record<(typeof CHAVES_ENV_IA)[number], string | undefined>> = {};

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    for (const chave of CHAVES_ENV_IA) {
      backupEnv[chave] = process.env[chave];
      delete process.env[chave];
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const chave of CHAVES_ENV_IA) {
      const original = backupEnv[chave];
      if (original === undefined) {
        delete process.env[chave];
      } else {
        process.env[chave] = original;
      }
    }
  });

  it("rejeita entradas vazias ou inválidas antes de fazer qualquer chamada HTTP", async () => {
    process.env["GEMINI_API_KEY"] = "chave-gemini-ficticia";

    await expect(callAi("   ", USER_VALIDO)).rejects.toThrow(/inválid/i);
    await expect(callAi(SYSTEM_VALIDO, "   ")).rejects.toThrow(/inválid/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejeita prompts acima de 40 mil caracteres antes de consumir tokens", async () => {
    process.env["GEMINI_API_KEY"] = "chave-gemini-ficticia";

    await expect(callAi(SYSTEM_VALIDO, "a".repeat(40_001))).rejects.toThrow(/excedeu/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lança erro claro quando nenhuma chave de IA está configurada", async () => {
    await expect(callAi(SYSTEM_VALIDO, USER_VALIDO)).rejects.toThrow(/Nenhuma chave de IA/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("chama o Gemini com header x-goog-api-key (sem chave na URL) e valida saída estruturada", async () => {
    process.env["GEMINI_API_KEY"] = "chave-secreta-gemini-123";
    fetchMock.mockResolvedValueOnce(respostaGeminiValida(JSON.stringify(RASCUNHO_VALIDO)));

    const resultado = await callAi(SYSTEM_VALIDO, USER_VALIDO);

    expect(resultado).toEqual(RASCUNHO_VALIDO);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [urlChamada, init] = fetchMock.mock.calls[0]!;
    const urlStr = String(urlChamada);
    expect(urlStr).toContain("gemini-3.5-flash-lite:generateContent");
    expect(urlStr).not.toContain("chave-secreta-gemini-123");
    expect(urlStr).not.toContain("?key=");

    const headers = new Headers(init?.headers);
    expect(headers.get("x-goog-api-key")).toBe("chave-secreta-gemini-123");
    expect(init?.signal).toBeDefined();
  });

  it("registra os tokens devolvidos pelo Gemini para controlar o orçamento", async () => {
    process.env["GEMINI_API_KEY"] = "chave-gemini-ficticia";
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(RASCUNHO_VALIDO) }] } }],
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 30,
            cachedContentTokenCount: 20,
            thoughtsTokenCount: 10,
            totalTokenCount: 140,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await callAi(SYSTEM_VALIDO, USER_VALIDO);

    const evento = JSON.parse(String(infoSpy.mock.calls.at(-1)?.[0]));
    expect(evento).toMatchObject({
      tokensEntradaIA: 100,
      tokensSaidaIA: 30,
      tokensCacheIA: 20,
      tokensRaciocinioIA: 10,
      tokensTotalIA: 140,
    });
  });

  it("rejeita JSON inválido da IA em vez de salvar texto bruto como rascunho", async () => {
    process.env["GEMINI_API_KEY"] = "chave-gemini-ficticia";
    fetchMock.mockResolvedValueOnce(respostaGeminiValida("Isto não é JSON { quebrado"));

    await expect(callAi(SYSTEM_VALIDO, USER_VALIDO)).rejects.toThrow(/inválid|JSON/i);
  });

  it("rejeita resposta com summary vazio, content curto demais ou acima do limite do LinkedIn", async () => {
    process.env["GEMINI_API_KEY"] = "chave-gemini-ficticia";

    // Summary em branco
    fetchMock.mockResolvedValueOnce(
      respostaGeminiValida(JSON.stringify({ summary: "   ", content: RASCUNHO_VALIDO.content })),
    );
    await expect(callAi(SYSTEM_VALIDO, USER_VALIDO)).rejects.toThrow(/inválid|schema|formato/i);

    // Content curto demais
    fetchMock.mockResolvedValueOnce(
      respostaGeminiValida(JSON.stringify({ summary: RASCUNHO_VALIDO.summary, content: "oi" })),
    );
    await expect(callAi(SYSTEM_VALIDO, USER_VALIDO)).rejects.toThrow(/inválid|schema|formato/i);

    // Content acima de 3000 caracteres
    fetchMock.mockResolvedValueOnce(
      respostaGeminiValida(
        JSON.stringify({
          summary: RASCUNHO_VALIDO.summary,
          content: "a".repeat(3001),
        }),
      ),
    );
    await expect(callAi(SYSTEM_VALIDO, USER_VALIDO)).rejects.toThrow(
      /inválid|schema|formato|limite/i,
    );
  });

  it("trata HTTP 429 (rate limit) e timeout com mensagens claras em português", async () => {
    process.env["GEMINI_API_KEY"] = "chave-gemini-ficticia";

    fetchMock.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    await expect(callAi(SYSTEM_VALIDO, USER_VALIDO)).rejects.toThrow(/Limite de requisições/i);

    const erroAbort = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    fetchMock.mockRejectedValueOnce(erroAbort);
    await expect(callAi(SYSTEM_VALIDO, USER_VALIDO)).rejects.toThrow(/tempo limite|timeout/i);
  });

  it("aciona fallback automático para OpenAI quando o Gemini falha e ambas as chaves existem", async () => {
    process.env["GEMINI_API_KEY"] = "chave-gemini-ficticia";
    process.env["OPENAI_API_KEY"] = "sk-chave-openai-ficticia";

    // Gemini retorna erro 503 -> deve acionar OpenAI automaticamente
    fetchMock
      .mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }))
      .mockResolvedValueOnce(respostaOpenAiValida(JSON.stringify(RASCUNHO_VALIDO)));

    const resultado = await callAi(SYSTEM_VALIDO, USER_VALIDO);

    expect(resultado).toEqual(RASCUNHO_VALIDO);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("generativelanguage.googleapis.com");
    expect(String(fetchMock.mock.calls[1]![0])).toContain("api.openai.com/v1/chat/completions");
  });

  it("aciona fallback automático para OpenAI também quando o Gemini devolve JSON malformado", async () => {
    process.env["GEMINI_API_KEY"] = "chave-gemini-ficticia";
    process.env["OPENAI_API_KEY"] = "sk-chave-openai-ficticia";

    fetchMock
      .mockResolvedValueOnce(respostaGeminiValida("texto solto sem json"))
      .mockResolvedValueOnce(respostaOpenAiValida(JSON.stringify(RASCUNHO_VALIDO)));

    const resultado = await callAi(SYSTEM_VALIDO, USER_VALIDO);

    expect(resultado).toEqual(RASCUNHO_VALIDO);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propaga erro combinado sem expor chaves de API quando Gemini e OpenAI falham", async () => {
    process.env["GEMINI_API_KEY"] = "SEGREDO_GEMINI_XYZ";
    process.env["OPENAI_API_KEY"] = "SEGREDO_OPENAI_ABC";

    fetchMock
      .mockResolvedValueOnce(new Response("Erro interno Gemini", { status: 500 }))
      .mockResolvedValueOnce(new Response("Erro interno OpenAI", { status: 502 }));

    let mensagemCapturada = "";
    try {
      await callAi(SYSTEM_VALIDO, USER_VALIDO);
    } catch (erro) {
      mensagemCapturada = erro instanceof Error ? erro.message : String(erro);
    }

    expect(mensagemCapturada).toMatch(/Gemini/i);
    expect(mensagemCapturada).toMatch(/OpenAI/i);
    expect(mensagemCapturada).not.toContain("SEGREDO_GEMINI_XYZ");
    expect(mensagemCapturada).not.toContain("SEGREDO_OPENAI_ABC");
  });

  it("usa OpenAI diretamente quando apenas OPENAI_API_KEY está configurada", async () => {
    process.env["OPENAI_API_KEY"] = "sk-openai-unica";
    process.env["OPENAI_MODEL"] = "gpt-4o-mini";

    fetchMock.mockResolvedValueOnce(respostaOpenAiValida(JSON.stringify(RASCUNHO_VALIDO)));

    const resultado = await callAi(SYSTEM_VALIDO, USER_VALIDO);

    expect(resultado).toEqual(RASCUNHO_VALIDO);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [urlChamada, init] = fetchMock.mock.calls[0]!;
    expect(String(urlChamada)).toContain("api.openai.com/v1/chat/completions");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer sk-openai-unica");
  });

  it("registra tokens e cache devolvidos pela OpenAI", async () => {
    process.env["OPENAI_API_KEY"] = "sk-openai-unica";
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(RASCUNHO_VALIDO) } }],
          usage: {
            prompt_tokens: 80,
            completion_tokens: 25,
            total_tokens: 105,
            prompt_tokens_details: { cached_tokens: 50 },
            completion_tokens_details: { reasoning_tokens: 5 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await callAi(SYSTEM_VALIDO, USER_VALIDO);

    const evento = JSON.parse(String(infoSpy.mock.calls.at(-1)?.[0]));
    expect(evento).toMatchObject({
      tokensEntradaIA: 80,
      tokensSaidaIA: 25,
      tokensCacheIA: 50,
      tokensRaciocinioIA: 5,
      tokensTotalIA: 105,
    });
  });
});
