/**
 * @file oauthState.server.ts
 * @description Geração e validação criptográfica do parâmetro 'state' do OAuth 2.0 (S02).
 * Protege o fluxo de autorização do GitHub contra CSRF, replay fora da janela de tempo
 * e vinculação indevida de conta entre usuários distintos.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { obterChaveMestraCriptografia } from "./connectionKeyCrypto.server";

/** Tempo de validade padrão de um state OAuth: 10 minutos */
export const TTL_PADRAO_STATE_OAUTH_MS = 10 * 60 * 1000;

/** Tolerância máxima para pequenas variações de relógio */
const TOLERANCIA_FUTURO_MS = 30_000;

interface PayloadStateOAuth {
  userId: string;
  ts: number;
  nonce: string;
}

function assinarPayloadState(payloadBase64Url: string): string {
  const chaveMestra = obterChaveMestraCriptografia();
  return createHmac("sha256", chaveMestra)
    .update(`github-oauth-state-v1:${payloadBase64Url}`)
    .digest("base64url");
}

/**
 * Gera um token 'state' autenticado via HMAC-SHA256 vinculado ao usuário autenticado.
 */
export function gerarStateOAuth(userId: string, agoraMs = Date.now()): string {
  const idLimpo = userId.trim();
  if (!idLimpo) {
    throw new Error("Identificador de usuário obrigatório para iniciar o fluxo OAuth.");
  }

  const payload: PayloadStateOAuth = {
    userId: idLimpo,
    ts: agoraMs,
    nonce: randomBytes(16).toString("hex"),
  };

  const payloadBase64Url = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const assinatura = assinarPayloadState(payloadBase64Url);
  return `${payloadBase64Url}.${assinatura}`;
}

/**
 * Valida a assinatura HMAC-SHA256, o vínculo com o usuário da sessão e a janela de expiração do 'state'.
 */
export function validarStateOAuth(
  stateRecebido: string,
  userIdEsperado: string,
  agoraMs = Date.now(),
  ttlMs = TTL_PADRAO_STATE_OAUTH_MS,
): PayloadStateOAuth {
  const partes = stateRecebido.trim().split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1]) {
    throw new Error("Estado de segurança OAuth inválido ou malformado.");
  }

  const [payloadBase64Url, assinaturaRecebida] = partes;
  const assinaturaEsperada = assinarPayloadState(payloadBase64Url);

  const bufRecebido = Buffer.from(assinaturaRecebida, "utf8");
  const bufEsperado = Buffer.from(assinaturaEsperada, "utf8");

  if (bufRecebido.length !== bufEsperado.length || !timingSafeEqual(bufRecebido, bufEsperado)) {
    throw new Error("Assinatura do estado OAuth inválida. Reinicie a conexão em Fontes.");
  }

  let payload: PayloadStateOAuth;
  try {
    payload = JSON.parse(
      Buffer.from(payloadBase64Url, "base64url").toString("utf8"),
    ) as PayloadStateOAuth;
  } catch {
    throw new Error("Conteúdo do estado OAuth corrompido.");
  }

  if (
    !payload ||
    typeof payload.userId !== "string" ||
    typeof payload.ts !== "number" ||
    typeof payload.nonce !== "string" ||
    payload.nonce.length < 16
  ) {
    throw new Error("Estrutura do estado OAuth inválida.");
  }

  if (payload.userId !== userIdEsperado) {
    throw new Error("O estado OAuth pertence a outra sessão de usuário. Operação bloqueada.");
  }

  const idadeMs = agoraMs - payload.ts;
  if (idadeMs > ttlMs || idadeMs < -TOLERANCIA_FUTURO_MS) {
    throw new Error("A solicitação de autorização do GitHub expirou. Tente conectar novamente.");
  }

  return payload;
}
