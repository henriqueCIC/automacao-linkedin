/**
 * Geração de rascunhos e síntese de commits com Gemini ou OpenAI.
 * Uso exclusivo no servidor; não importar no pacote do navegador.
 */

export type AiDraft = { summary: string; content: string };

export async function callAi(system: string, user: string): Promise<AiDraft> {
  const geminiKey = process.env["GEMINI_API_KEY"] || process.env["GOOGLE_API_KEY"];
  const openaiKey = process.env["OPENAI_API_KEY"];

  if (!geminiKey && !openaiKey) {
    throw new Error(
      "Nenhuma chave de IA configurada. Defina GEMINI_API_KEY (recomendada, gratuita no Google AI Studio) ou OPENAI_API_KEY no arquivo .env.",
    );
  }

  // 1. Prioridade: Google Gemini oficial direto
  if (geminiKey) {
    const model = process.env["GEMINI_MODEL"] || "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: {
          response_mime_type: "application/json",
          response_schema: {
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

    if (!res.ok) {
      const body = await res.text();
      console.error(`Erro na API do Gemini [${res.status}]: ${body}`);
      if (res.status === 429) throw new Error("Limite de requisições da IA atingido. Tente em instantes.");
      throw new Error(`Falha na API do Gemini (${res.status}). Verifique a GEMINI_API_KEY.`);
    }

    const payload = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    try {
      const parsed = JSON.parse(raw) as AiDraft;
      return { summary: parsed.summary ?? "", content: parsed.content ?? "" };
    } catch {
      return { summary: "", content: raw };
    }
  }

  // 2. OpenAI quando não há chave Gemini; fallback após falha ainda não implementado.
  const openaiModel = process.env["OPENAI_MODEL"] || "gpt-4o-mini";
  const openaiUrl = process.env["OPENAI_BASE_URL"] || "https://api.openai.com/v1/chat/completions";

  const res = await fetch(openaiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openaiModel,
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

  if (!res.ok) {
    const body = await res.text();
    console.error(`Erro na API da OpenAI [${res.status}]: ${body}`);
    if (res.status === 429) throw new Error("Muitos pedidos em sequência. Tente de novo em instantes.");
    throw new Error(`Falha na API da OpenAI (${res.status}).`);
  }

  const payload = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = payload.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(raw) as AiDraft;
    return { summary: parsed.summary ?? "", content: parsed.content ?? "" };
  } catch {
    return { summary: "", content: raw };
  }
}
