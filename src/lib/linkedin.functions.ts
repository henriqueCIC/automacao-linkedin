import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  LINKEDIN_API_BASE,
  obterTokenLinkedInDoUsuario,
  publicarRascunhoAprovadoNoLinkedIn,
} from "./linkedin.server";

/** Informa à interface se existe uma conta LinkedIn autorizada para publicação. */
export const getLinkedInStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const token = await obterTokenLinkedInDoUsuario(context.userId);
    if (!token) return { connected: false as const };

    const res = await fetch(`${LINKEDIN_API_BASE}/v2/userinfo`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      console.error(`Falha ao consultar identidade no LinkedIn [HTTP ${res.status}]`);
      return { connected: false as const };
    }
    const info = (await res.json()) as { sub?: string; name?: string };
    return { connected: true as const, name: info.name ?? null };
  });

/** Consulta uma publicação já enviada ao LinkedIn pertencente ao usuário autenticado. */
export const checkPublishedPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ draftId: z.string().trim().min(1) }))
  .handler(async ({ data, context }) => {
    const { data: draft, error } = await context.supabase
      .from("post_drafts")
      .select("id, linkedin_post_id, published_at, status")
      .eq("id", data.draftId)
      .eq("user_id", context.userId)
      .single();
    if (error || !draft) throw new Error("Rascunho não encontrado.");
    if (!draft.linkedin_post_id) {
      return { state: "nao_publicado" as const, url: null, checkedAt: new Date().toISOString() };
    }

    const url = `https://www.linkedin.com/feed/update/${draft.linkedin_post_id}`;
    const token = await obterTokenLinkedInDoUsuario(context.userId);
    if (!token) {
      return { state: "sem_autorizacao" as const, url, checkedAt: new Date().toISOString() };
    }

    const res = await fetch(
      `${LINKEDIN_API_BASE}/v2/ugcPosts/${encodeURIComponent(draft.linkedin_post_id)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Restli-Protocol-Version": "2.0.0",
        },
      },
    );
    if (!res.ok) {
      console.error(`Falha ao consultar publicação no LinkedIn [HTTP ${res.status}]`);
      return {
        state: "indisponivel" as const,
        url,
        detail: `${res.status}`,
        checkedAt: new Date().toISOString(),
      };
    }
    const post = (await res.json()) as { lifecycleState?: string };
    return {
      state: (post.lifecycleState ?? "PUBLISHED") as string,
      url,
      checkedAt: new Date().toISOString(),
    };
  });

/** Publica somente um rascunho pertencente e explicitamente aprovado pelo usuário autenticado. */
export const publishApprovedDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ draftId: z.string().trim().min(1) }))
  .handler(async ({ data, context }) => {
    return publicarRascunhoAprovadoNoLinkedIn(context.supabase, context.userId, data.draftId);
  });
