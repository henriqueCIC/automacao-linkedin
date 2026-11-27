import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { autenticarRequisicaoCron, executarCicloCron } from "@/lib/cron.server";

export const Route = createFileRoute("/api/public/coletar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = process.env["SUPABASE_URL"];
        const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

        if (!supabaseUrl || !serviceRoleKey) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Configuração do servidor ausente para execução do cron.",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const supabaseAdmin = createClient<Database>(supabaseUrl, serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const authError = await autenticarRequisicaoCron(request, supabaseAdmin);
        if (authError) return authError;

        try {
          const payload = await executarCicloCron(supabaseAdmin);
          return new Response(JSON.stringify(payload), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Erro ao processar o cron.";
          return new Response(JSON.stringify({ success: false, error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
