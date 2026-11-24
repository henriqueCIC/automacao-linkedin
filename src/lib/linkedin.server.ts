/**
 * @file linkedin.server.ts
 * @description Helpers exclusivos de servidor para resolução de credenciais individuais do LinkedIn (S03).
 * Isolado em arquivo *.server.ts para que o bundler do TanStack Start nunca o inclua no cliente.
 */

import { getConnectionForUser } from "./appUserConnections.server";

export const LINKEDIN_CONNECTOR_ID = "linkedin";

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
