import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { collectForUser } from "@/lib/collect.server";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/api/public/coletar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authError = await authenticateCronRequest(request);
        if (authError) return authError;

        const supabaseAdmin = createClient<Database>(
          process.env["SUPABASE_URL"]!,
          process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
          { auth: { autoRefreshToken: false, persistSession: false } },
        );

        const now = new Date().toISOString();
        const { data: settingsRows, error: settingsError } = await supabaseAdmin
          .from("automation_settings")
          .select("user_id, daily_time, timezone, enabled, last_run_date")
          .eq("enabled", true);

        if (settingsError) {
          console.error("Cron: failed to load automation settings", settingsError);
          return new Response(JSON.stringify({ success: false, error: settingsError.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const results: Array<{
          userId: string;
          status: string;
          commitsFound?: number;
          repositories?: string[];
          message?: string | null;
        }> = [];

        for (const settings of settingsRows ?? []) {
          if (!shouldRunNow(settings.daily_time, settings.timezone, settings.last_run_date)) {
            results.push({
              userId: settings.user_id,
              status: "ignorado",
              message: "fora do horário",
            });
            continue;
          }

          try {
            const result = await collectForUser(supabaseAdmin, settings.user_id, "cron");
            await supabaseAdmin
              .from("automation_settings")
              .update({ last_run_date: todayInTimezone(settings.timezone) })
              .eq("user_id", settings.user_id);
            results.push({
              userId: settings.user_id,
              status: result.status,
              commitsFound: result.commitsFound,
              repositories: result.repositories,
              message: result.message ?? null,
            });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Cron: error collecting for user ${settings.user_id}`, error);
            results.push({ userId: settings.user_id, status: "erro", message });
          }
        }

        return new Response(
          JSON.stringify({ success: true, processed: results.length, at: now, results }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});

async function authenticateCronRequest(request: Request): Promise<Response | null> {
  const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
  const token = match?.[1];
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseAdmin = createClient<Database>(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data, error } = await supabaseAdmin
    .from("cron_secrets")
    .select("secret")
    .eq("id", 1)
    .single();

  if (error || !data) {
    console.error("Cron: could not load cron_secrets", error);
    return new Response("Unauthorized", { status: 401 });
  }

  const expected = Buffer.from(data.secret);
  const provided = Buffer.from(token);
  const { timingSafeEqual } = await import("node:crypto");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return new Response("Unauthorized", { status: 401 });
  }

  return null;
}

function shouldRunNow(dailyTime: string, timezone: string, lastRunDate: string | null): boolean {
  const { date, time } = nowParts(timezone);
  if (lastRunDate === date) return false;
  return time >= dailyTime.slice(0, 5);
}

function todayInTimezone(timezone: string): string {
  return nowParts(timezone).date;
}

function nowParts(timezone: string): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}
