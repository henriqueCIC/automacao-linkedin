import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getConnectionForUser } from "./appUserConnections.server";

const LINKEDIN_API_BASE = "https://api.linkedin.com";

async function getLinkedInToken(userId?: string): Promise<string | null> {
  if (userId) {
    const conn = await getConnectionForUser(userId, "linkedin");
    if (conn?.connectionAPIKey) return conn.connectionAPIKey;
  }
  return process.env["LINKEDIN_ACCESS_TOKEN"] || process.env["LINKEDIN_API_KEY"] || null;
}

/** Tells the UI whether a LinkedIn account is authorized for publishing. */
export const getLinkedInStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const token = await getLinkedInToken(context.userId);
    if (!token) return { connected: false as const };

    const res = await fetch(`${LINKEDIN_API_BASE}/v2/userinfo`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`LinkedIn userinfo failed [${res.status}]: ${body}`);
      return { connected: false as const };
    }
    const info = (await res.json()) as { sub?: string; name?: string };
    return { connected: true as const, name: info.name ?? null };
  });

/** Live check of a post already sent to LinkedIn. */
export const checkPublishedPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { draftId: string }) => input)
  .handler(async ({ data, context }) => {
    const { data: draft, error } = await context.supabase
      .from("post_drafts")
      .select("id, linkedin_post_id, published_at, status")
      .eq("id", data.draftId)
      .single();
    if (error || !draft) throw new Error("Rascunho não encontrado.");
    if (!draft.linkedin_post_id) {
      return { state: "nao_publicado" as const, url: null, checkedAt: new Date().toISOString() };
    }

    const url = `https://www.linkedin.com/feed/update/${draft.linkedin_post_id}`;
    const token = await getLinkedInToken(context.userId);
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
      const body = await res.text();
      console.error(`LinkedIn post lookup failed [${res.status}]: ${body}`);
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

/** Publishes ONLY a draft the user has explicitly approved. */
export const publishApprovedDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { draftId: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: draft, error } = await supabase
      .from("post_drafts")
      .select("id, content, status")
      .eq("id", data.draftId)
      .single();
    if (error || !draft) throw new Error("Rascunho não encontrado.");
    if (draft.status !== "aprovado") {
      throw new Error("Só é possível publicar um post que você aprovou nesta tela.");
    }

    const token = await getLinkedInToken(context.userId);
    if (!token) throw new Error("Nenhuma conta do LinkedIn autorizada ainda.");

    const meRes = await fetch(`${LINKEDIN_API_BASE}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) {
      const body = await meRes.text();
      console.error(`LinkedIn userinfo failed [${meRes.status}]: ${body}`);
      throw new Error("A autorização do LinkedIn precisa ser renovada.");
    }
    const me = (await meRes.json()) as { sub?: string };
    if (!me.sub) throw new Error("Não foi possível identificar a conta do LinkedIn.");

    const postRes = await fetch(`${LINKEDIN_API_BASE}/v2/ugcPosts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: `urn:li:person:${me.sub}`,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: draft.content },
            shareMediaCategory: "NONE",
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
    });

    if (!postRes.ok) {
      const body = await postRes.text();
      console.error(`LinkedIn publish failed [${postRes.status}]: ${body}`);
      throw new Error(`O LinkedIn recusou a publicação (${postRes.status}).`);
    }

    const published = (await postRes.json()) as { id?: string };
    await supabase
      .from("post_drafts")
      .update({
        status: "publicado",
        published_at: new Date().toISOString(),
        linkedin_post_id: published.id ?? null,
      })
      .eq("id", draft.id);

    return { ok: true, postId: published.id ?? null };
  });
