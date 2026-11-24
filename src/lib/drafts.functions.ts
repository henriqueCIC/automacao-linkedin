import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAi } from "./ai.server";

const TONES: Record<string, string> = {
  profissional: "profissional, direto e focado em resultado",
  narrativo: "narrativa pessoal, humana, contando a história do dia",
  tecnico: "técnico e detalhado, explicando decisões e aprendizados",
};

const SYSTEM = [
  "Você é um redator de posts para LinkedIn, em português do Brasil.",
  "Receberá as anotações do dia de trabalho de uma pessoa.",
  "Devolva dois campos:",
  "- summary: um resumo curto (2 a 4 frases) do que a pessoa fez no dia, em tópicos claros de leitura rápida.",
  "- content: o rascunho do post para o LinkedIn, entre 700 e 1200 caracteres, primeira pessoa, sem hashtags exageradas (no máximo 3 ao final), sem emojis em excesso, sem inventar números, nomes de clientes ou resultados que não estejam nas anotações.",
  "Se as anotações forem vagas, escreva algo honesto e genérico, nunca invente fatos.",
].join("\n");

export const generateDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ entryId: z.string(), tone: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: entry, error } = await supabase
      .from("day_entries")
      .select("id, entry_date, raw_notes")
      .eq("id", data.entryId)
      .single();
    if (error || !entry) throw new Error("Registro do dia não encontrado.");

    const tone = data.tone && TONES[data.tone] ? data.tone : "profissional";
    const draft = await callAi(
      SYSTEM,
      [
        `Data: ${entry.entry_date}`,
        `Tom desejado: ${TONES[tone]}`,
        "Anotações do dia:",
        entry.raw_notes,
      ].join("\n"),
    );

    const { data: inserted, error: insertError } = await supabase
      .from("post_drafts")
      .insert({
        user_id: userId,
        day_entry_id: entry.id,
        summary: draft.summary,
        content: draft.content,
        tone,
        status: "rascunho",
      })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);

    return { id: inserted.id as string };
  });

export const refineDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ draftId: z.string(), feedback: z.string() }))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const feedback = data.feedback.trim().slice(0, 2000);
    if (!feedback) throw new Error("Escreva o que deve mudar no post.");

    const { data: draft, error } = await supabase
      .from("post_drafts")
      .select("id, content, summary, tone, status, day_entries(raw_notes, entry_date)")
      .eq("id", data.draftId)
      .single();
    if (error || !draft) throw new Error("Rascunho não encontrado.");
    if (draft.status === "publicado") throw new Error("Este post já foi publicado.");

    const notes = (draft.day_entries as { raw_notes?: string } | null)?.raw_notes ?? "";
    const revised = await callAi(
      SYSTEM,
      [
        `Tom desejado: ${TONES[draft.tone as string] ?? TONES["profissional"]}`,
        "Anotações originais do dia:",
        notes,
        "",
        "Versão atual do post:",
        draft.content,
        "",
        "Ajustes pedidos pela pessoa (siga à risca):",
        feedback,
      ].join("\n"),
    );

    const { error: updateError } = await supabase
      .from("post_drafts")
      .update({
        summary: revised.summary || draft.summary,
        content: revised.content,
        status: "rascunho",
        feedback,
        approved_at: null,
      })
      .eq("id", draft.id);
    if (updateError) throw new Error(updateError.message);

    return { ok: true };
  });
