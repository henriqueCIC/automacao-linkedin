/**
 * @file connectionKeyCrypto.server.ts
 * @description Criptografia autenticada AES-256-GCM para credenciais OAuth de usuários (S01).
 * Exige obrigatoriamente uma chave mestra de 32 bytes (256 bits) codificada em base64
 * via ENCRYPTION_SECRET; não utiliza chaves fixas de fallback.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const TAMANHO_CHAVE_AES_256_BYTES = 32;
const TAMANHO_IV_GCM_BYTES = 12;
const TAMANHO_AUTH_TAG_GCM_BYTES = 16;

/**
 * Obtém e valida a chave mestra de 32 bytes a partir do ambiente do servidor.
 * @throws Erro explícito caso ENCRYPTION_SECRET esteja ausente ou não possua 32 bytes.
 */
export function obterChaveMestraCriptografia(): Buffer {
  const raw = (
    process.env["ENCRYPTION_SECRET"] || process.env["APP_USER_CONNECTION_KEY_SECRET"]
  )?.trim();

  if (!raw) {
    throw new Error(
      "Configuração de segurança ausente: defina ENCRYPTION_SECRET no .env com uma chave base64 de 32 bytes (gere com 'openssl rand -base64 32').",
    );
  }

  const chave = Buffer.from(raw, "base64");
  if (chave.length !== TAMANHO_CHAVE_AES_256_BYTES) {
    throw new Error(
      `Configuração de segurança inválida: ENCRYPTION_SECRET deve possuir exatamente 32 bytes após decodificação base64 (recebido: ${chave.length} bytes).`,
    );
  }

  return chave;
}

export function encryptConnectionKey(plaintext: string): string {
  const chave = obterChaveMestraCriptografia();
  const iv = randomBytes(TAMANHO_IV_GCM_BYTES);
  const cipher = createCipheriv("aes-256-gcm", chave, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decryptConnectionKey(stored: string): string {
  const chave = obterChaveMestraCriptografia();
  const buf = Buffer.from(stored, "base64");
  const tamanhoMinimo = TAMANHO_IV_GCM_BYTES + TAMANHO_AUTH_TAG_GCM_BYTES + 1;

  if (buf.length < tamanhoMinimo) {
    throw new Error("Credencial criptografada corrompida ou truncada.");
  }

  const iv = buf.subarray(0, TAMANHO_IV_GCM_BYTES);
  const tag = buf.subarray(TAMANHO_IV_GCM_BYTES, TAMANHO_IV_GCM_BYTES + TAMANHO_AUTH_TAG_GCM_BYTES);
  const ct = buf.subarray(TAMANHO_IV_GCM_BYTES + TAMANHO_AUTH_TAG_GCM_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", chave, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
