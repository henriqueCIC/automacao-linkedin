import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { collectForUser } from "./collect.server";
import { ehFusoHorarioValido, normalizarFusoHorario } from "./timezone";

export const getGitHubCollectionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: settings }, { data: lastRun }] = await Promise.all([
      supabase.from("automation_settings").select("*").eq("user_id", userId).single(),
      supabase
        .from("collection_runs")
        .select("id, created_at, status, commits_found, repositories, message")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    return {
      settings: settings ?? null,
      lastRun: lastRun ?? null,
    };
  });

export const runCollectionNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ runId: z.string().uuid().optional() }).optional())
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const result = await collectForUser(supabase, userId, "manual", data?.runId);
    return result;
  });

export const getCollectionHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("collection_runs")
      .select(
        "id, created_at, trigger, status, commits_found, repositories, message, post_draft_id",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getAutomationSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("automation_settings")
      .select("*")
      .eq("user_id", userId)
      .single();
    if (error?.code === "PGRST116" || !data) {
      const insert = {
        user_id: userId,
        enabled: true,
        daily_time: "18:00",
        timezone: "America/Bahia",
        default_tone: "profissional",
        max_commits_per_day: 15,
        notify_desktop: true,
        notify_email: false,
      };
      const { data: created, error: insertError } = await supabase
        .from("automation_settings")
        .insert(insert)
        .select()
        .single();
      if (insertError) throw new Error(insertError.message);
      return created;
    }
    if (error) {
      throw new Error((error as { message?: string }).message ?? "Erro ao carregar configurações");
    }
    return {
      ...data,
      timezone: normalizarFusoHorario(data.timezone),
    };
  });

const updateSettingsSchema = z.object({
  enabled: z.boolean(),
  dailyTime: z.string().regex(/^\d{2}:\d{2}$/, "Informe o horário no formato HH:MM."),
  timezone: z
    .string()
    .trim()
    .min(1)
    .refine(ehFusoHorarioValido, "Fuso horário inválido. Selecione um fuso IANA suportado."),
  defaultTone: z.enum(["profissional", "narrativo", "tecnico"]),
  maxCommitsPerDay: z.number().int().min(1).max(100),
  notifyDesktop: z.boolean(),
  notifyEmail: z.boolean(),
});

export const updateAutomationSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(updateSettingsSchema)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("automation_settings").upsert(
      {
        user_id: userId,
        enabled: data.enabled,
        daily_time: data.dailyTime,
        timezone: data.timezone,
        default_tone: data.defaultTone,
        max_commits_per_day: data.maxCommitsPerDay,
        notify_desktop: data.notifyDesktop,
        notify_email: data.notifyEmail,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
