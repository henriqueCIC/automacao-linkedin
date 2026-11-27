/**
 * @file linkedin.server.ts
 * @description Helpers exclusivos de servidor para resolução de credenciais individuais (S03)
 * e publicação com reserva atômica, proteção contra concorrência e reconciliação (P01).
 * Isolado em arquivo *.server.ts para que o bundler do TanStack Start nunca o inclua no cliente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getConnectionForUser } from "./appUserConnections.server";

export const LINKEDIN_CONNECTOR_ID = "linkedin";
export const LINKEDIN_API_BASE = "https://api.linkedin.com";
const TIMEOUT_LINKEDIN_MS = 25_000;

export function obterBaseApiLinkedIn(): string {
  return process.env["LINKEDIN_API_BASE_URL"]?.trim() || LINKEDIN_API_BASE;
}

/**
 * Obtém exclusivamente a credencial individual do LinkedIn pertencente ao usuário autenticado (S03).
 * Nunca utiliza variáveis de ambiente globais para evitar compartilhamento de conta entre usuários.
 */
export async function obterTokenLinkedInDoUsuario(userId: string): Promise<string | null> {
  const idLimpo = userId.trim();
  if (!idLimpo) return null;
  const conn = await getConnectionForUser(idLimpo, LINKEDIN_CONNECTOR_ID);
  return conn?.connectionAPIKey ?? null;
}

export interface ResultadoPublicacaoLinkedIn {
  ok: true;
  postId: string | null;
  reconciliado?: boolean;
}

/**
 * Publica um rascunho aprovado no LinkedIn com garantias contra duplicidade e falhas parciais (P01):
 * 1. Se `linkedin_post_id` já existir, reconcilia o status local para 'publicado' sem reenviar o post.
 * 2. Reserva atomicamente o rascunho mudando `status` de 'aprovado' para 'publicando'.
 * 3. Reverte para 'aprovado' apenas em falhas definitivas anteriores à criação do post (userinfo ou HTTP 4xx).
 * 4. Mantém 'publicando' em falhas de resultado incerto (timeout, rede ou HTTP 5xx no POST), exigindo
 *    verificação/reconciliação humana antes de qualquer nova tentativa.
 */
export async function publicarRascunhoAprovadoNoLinkedIn(
  supabase: SupabaseClient<Database>,
  userId: string,
  draftId: string,
): Promise<ResultadoPublicacaoLinkedIn> {
  const { data: draft, error } = await supabase
    .from("post_drafts")
    .select("id, content, status, linkedin_post_id, published_at")
    .eq("id", draftId)
    .eq("user_id", userId)
    .single();

  if (error || !draft) {
    throw new Error("Rascunho não encontrado.");
  }

  // 1. Reconciliação idempotente caso uma publicação anterior já tenha obtido o ID remoto
  if (draft.linkedin_post_id) {
    if (draft.status !== "publicado") {
      const { error: reconError } = await supabase
        .from("post_drafts")
        .update({
          status: "publicado",
          published_at: draft.published_at ?? new Date().toISOString(),
        })
        .eq("id", draft.id)
        .eq("user_id", userId);
      if (reconError) {
        throw new Error("O post já existe no LinkedIn, mas falhou ao reconciliar o status local.");
      }
    }
    return { ok: true, postId: draft.linkedin_post_id, reconciliado: true };
  }

  if (draft.status === "publicando") {
    throw new Error(
      "Este rascunho já está em publicação ou teve resultado incerto. Confirme no LinkedIn antes de repetir.",
    );
  }

  if (draft.status !== "aprovado") {
    throw new Error("Só é possível publicar um post que você aprovou nesta tela.");
  }

  const token = await obterTokenLinkedInDoUsuario(userId);
  if (!token) {
    throw new Error("Nenhuma conta do LinkedIn autorizada para o seu usuário.");
  }

  // 2. Reserva otimista atômica (Compare-And-Swap) impedindo corrida de dois cliques simultâneos
  const { data: reservado, error: erroReserva } = await supabase
    .from("post_drafts")
    .update({ status: "publicando" })
    .eq("id", draft.id)
    .eq("user_id", userId)
    .eq("status", "aprovado")
    .is("linkedin_post_id", null)
    .select("id, content")
    .maybeSingle();

  if (erroReserva) {
    throw new Error("Não foi possível reservar o rascunho para publicação.");
  }
  if (!reservado) {
    throw new Error("Publicação concorrente bloqueada: este rascunho já está sendo processado.");
  }

  const reverterReservaParaAprovado = async () => {
    await supabase
      .from("post_drafts")
      .update({ status: "aprovado" })
      .eq("id", draft.id)
      .eq("user_id", userId)
      .eq("status", "publicando");
  };

  // 3. Consulta identidade (anterior ao efeito colateral de publicar — seguro reverter se falhar)
  const baseLinkedIn = obterBaseApiLinkedIn();
  let meSub: string;
  try {
    const meRes = await fetch(`${baseLinkedIn}/v2/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_LINKEDIN_MS),
    });
    if (!meRes.ok) {
      console.error(`Falha ao consultar identidade no LinkedIn [HTTP ${meRes.status}]`);
      await reverterReservaParaAprovado();
      throw new Error("A autorização do LinkedIn precisa ser renovada.");
    }
    const me = (await meRes.json()) as { sub?: string };
    if (!me.sub) {
      await reverterReservaParaAprovado();
      throw new Error("Não foi possível identificar a conta do LinkedIn.");
    }
    meSub = me.sub;
  } catch (erro) {
    if (
      erro instanceof Error &&
      (erro.message.includes("renovada") || erro.message.includes("identificar"))
    ) {
      throw erro;
    }
    await reverterReservaParaAprovado();
    throw new Error("Falha de conexão ao verificar sua conta do LinkedIn antes de publicar.");
  }

  // 4. Envia publicação ao LinkedIn
  let postRes: Response;
  try {
    postRes = await fetch(`${baseLinkedIn}/v2/ugcPosts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      signal: AbortSignal.timeout(TIMEOUT_LINKEDIN_MS),
      body: JSON.stringify({
        author: `urn:li:person:${meSub}`,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: reservado.content },
            shareMediaCategory: "NONE",
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
    });
  } catch {
    // Resultado incerto: o LinkedIn pode ter recebido o POST antes da queda de conexão/timeout
    throw new Error(
      "Resultado incerto ao publicar no LinkedIn (falha de rede/tempo limite). O rascunho permanece bloqueado para reconciliação manual; confirme no seu perfil antes de repetir.",
    );
  }

  if (!postRes.ok) {
    console.error(`Falha ao publicar no LinkedIn [HTTP ${postRes.status}]`);
    if (postRes.status >= 400 && postRes.status < 500) {
      // Recusa definitiva do cliente/validação antes de criar o post: seguro reverter
      await reverterReservaParaAprovado();
      throw new Error(`O LinkedIn recusou a publicação (${postRes.status}).`);
    }
    // HTTP 5xx em POST tem resultado incerto: mantém status 'publicando' para evitar duplicação
    throw new Error(
      `Erro HTTP ${postRes.status} com resultado incerto no LinkedIn. Confirme no seu perfil antes de tentar reconciliar.`,
    );
  }

  const published = (await postRes.json()) as { id?: string };
  const postId = published.id ?? null;

  const { error: updateError } = await supabase
    .from("post_drafts")
    .update({
      status: "publicado",
      published_at: new Date().toISOString(),
      linkedin_post_id: postId,
    })
    .eq("id", draft.id)
    .eq("user_id", userId);

  if (updateError) {
    throw new Error(
      `O post foi publicado no LinkedIn (${postId ?? "sem ID"}), mas falhou ao atualizar o status local. Não republique para evitar duplicidade.`,
    );
  }

  return { ok: true, postId };
}
