import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAi } from "./ai.server";
import { construirPromptRascunhoManual, construirPromptRefinamento } from "./prompts";

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

    const prompt = construirPromptRascunhoManual({
      dataEntrada: entry.entry_date,
      anotacoes: entry.raw_notes,
      tom: data.tone ?? null,
    });
    const draft = await callAi(prompt.system, prompt.user);

    const { data: inserted, error: insertError } = await supabase
      .from("post_drafts")
      .insert({
        user_id: userId,
        day_entry_id: entry.id,
        summary: draft.summary,
        content: draft.content,
        tone: prompt.tomAplicado,
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
    const prompt = construirPromptRefinamento({
      anotacoesOriginais: notes,
      conteudoAtual: draft.content,
      feedbackUsuario: feedback,
      tom: draft.tone,
    });
    const revised = await callAi(prompt.system, prompt.user);

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
