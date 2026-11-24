/**
 * @file security.test.ts
 * @description Testes unitários e de regressão para os controles críticos de segurança da Etapa 3.1:
 * - S01: obrigatoriedade e validação de ENCRYPTION_SECRET de 32 bytes (sem chave fixa de fallback).
 * - S02: geração e validação de state OAuth assinado (HMAC-SHA256, vínculo de userId e expiração).
 * - S03: isolamento estrito de credencial do LinkedIn por usuário (sem fallback para token global).
 * - S04: descarte de arquivos sensíveis (.env, .pem, .key) e mascaramento de segredos em diffs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/appUserConnections.server", () => ({
  GITHUB_CONNECTOR_ID: "github",
  GITHUB_SCOPES: ["read:user", "repo"],
  getConnectionForUser: vi.fn(),
  saveConnectionKeyForUser: vi.fn(),
  deleteConnectionForUser: vi.fn(),
  saveAccountLogin: vi.fn(),
  markReconnectRequired: vi.fn(),
}));

import { decryptConnectionKey, encryptConnectionKey } from "@/lib/connectionKeyCrypto.server";
import { gerarStateOAuth, validarStateOAuth } from "@/lib/oauthState.server";
import { getConnectionForUser } from "@/lib/appUserConnections.server";
import { obterTokenLinkedInDoUsuario } from "@/lib/linkedin.server";
import { deveIncluirArquivo } from "@/lib/commit-file-filter";
import { MARCADOR_SEGREDO_MASCARADO, sanitizarSegredosEmTexto } from "@/lib/secret-sanitizer";

const CHAVE_32_BYTES_BASE64 = Buffer.alloc(32, 7).toString("base64");

describe("S01 — Criptografia de credenciais sem chave fixa de fallback", () => {
  const backupEncryptionSecret = process.env["ENCRYPTION_SECRET"];
  const backupLegacySecret = process.env["APP_USER_CONNECTION_KEY_SECRET"];

  beforeEach(() => {
    delete process.env["ENCRYPTION_SECRET"];
    delete process.env["APP_USER_CONNECTION_KEY_SECRET"];
  });

  afterEach(() => {
    if (backupEncryptionSecret === undefined) {
      delete process.env["ENCRYPTION_SECRET"];
    } else {
      process.env["ENCRYPTION_SECRET"] = backupEncryptionSecret;
    }
    if (backupLegacySecret === undefined) {
      delete process.env["APP_USER_CONNECTION_KEY_SECRET"];
    } else {
      process.env["APP_USER_CONNECTION_KEY_SECRET"] = backupLegacySecret;
    }
  });

  it("recusa criptografar ou descriptografar quando ENCRYPTION_SECRET está ausente", () => {
    expect(() => encryptConnectionKey("token-secreto")).toThrow(/ENCRYPTION_SECRET/i);
  });

  it("recusa chaves que não possuam exatamente 32 bytes após decodificação base64", () => {
    process.env["ENCRYPTION_SECRET"] = Buffer.from("chave-curta").toString("base64");
    expect(() => encryptConnectionKey("token-secreto")).toThrow(/32 bytes/i);
  });

  it("criptografa e descriptografa com AES-256-GCM quando ENCRYPTION_SECRET é válida e rejeita adulteração", () => {
    process.env["ENCRYPTION_SECRET"] = CHAVE_32_BYTES_BASE64;
    const cifrado = encryptConnectionKey("gho_meu_token_real");
    expect(cifrado).not.toContain("gho_meu_token_real");
    expect(decryptConnectionKey(cifrado)).toBe("gho_meu_token_real");

    // Adulteração do ciphertext deve falhar na verificação da AuthTag GCM
    const bufferAdulterado = Buffer.from(cifrado, "base64");
    bufferAdulterado[bufferAdulterado.length - 1]! ^= 0xff;
    expect(() => decryptConnectionKey(bufferAdulterado.toString("base64"))).toThrow();
  });
});

describe("S02 — Validação de state assinado no OAuth do GitHub", () => {
  const backupEncryptionSecret = process.env["ENCRYPTION_SECRET"];

  beforeEach(() => {
    process.env["ENCRYPTION_SECRET"] = CHAVE_32_BYTES_BASE64;
  });

  afterEach(() => {
    if (backupEncryptionSecret === undefined) {
      delete process.env["ENCRYPTION_SECRET"];
    } else {
      process.env["ENCRYPTION_SECRET"] = backupEncryptionSecret;
    }
  });

  it("gera state assinado e valida com sucesso para o mesmo usuário dentro do TTL", () => {
    const agora = 1_700_000_000_000;
    const state = gerarStateOAuth("user-123", agora);
    const validado = validarStateOAuth(state, "user-123", agora + 60_000);

    expect(validado.userId).toBe("user-123");
    expect(validado.ts).toBe(agora);
  });

  it("bloqueia state com assinatura adulterada, usuário diferente ou expirado", () => {
    const agora = 1_700_000_000_000;
    const state = gerarStateOAuth("user-123", agora);

    // Usuário diferente (tentativa de CSRF / troca de conta)
    expect(() => validarStateOAuth(state, "outro-usuario", agora + 1000)).toThrow(
      /outra sessão|usuário/i,
    );

    // Expirado (após 15 minutos)
    expect(() => validarStateOAuth(state, "user-123", agora + 15 * 60 * 1000)).toThrow(/expirou/i);

    // Assinatura adulterada
    const [payload] = state.split(".");
    expect(() => validarStateOAuth(`${payload}.assinaturaInvalida`, "user-123", agora)).toThrow(
      /Assinatura/i,
    );
  });
});

describe("S03 — Isolamento de credencial do LinkedIn por usuário", () => {
  const backupLinkedInToken = process.env["LINKEDIN_ACCESS_TOKEN"];
  const backupLinkedInApiKey = process.env["LINKEDIN_API_KEY"];

  beforeEach(() => {
    process.env["LINKEDIN_ACCESS_TOKEN"] = "token-global-perigoso";
    process.env["LINKEDIN_API_KEY"] = "apikey-global-perigosa";
  });

  afterEach(() => {
    if (backupLinkedInToken === undefined) {
      delete process.env["LINKEDIN_ACCESS_TOKEN"];
    } else {
      process.env["LINKEDIN_ACCESS_TOKEN"] = backupLinkedInToken;
    }
    if (backupLinkedInApiKey === undefined) {
      delete process.env["LINKEDIN_API_KEY"];
    } else {
      process.env["LINKEDIN_API_KEY"] = backupLinkedInApiKey;
    }
  });

  it("não utiliza token global do ambiente quando o usuário não possui conexão própria", async () => {
    vi.mocked(getConnectionForUser).mockResolvedValueOnce(null);

    const token = await obterTokenLinkedInDoUsuario("user-sem-linkedin");

    expect(token).toBeNull();
    expect(getConnectionForUser).toHaveBeenCalledWith("user-sem-linkedin", "linkedin");
  });

  it("retorna exclusivamente o token individual armazenado para o usuário autenticado", async () => {
    vi.mocked(getConnectionForUser).mockResolvedValueOnce({
      connectionAPIKey: "token-individual-do-usuario",
      accountLogin: "henrique",
      reconnectRequired: false,
    });

    const token = await obterTokenLinkedInDoUsuario("user-com-linkedin");

    expect(token).toBe("token-individual-do-usuario");
  });
});

describe("S04 — Descarte de arquivos sensíveis e sanitização de segredos em diffs", () => {
  it("rejeita arquivos de variáveis de ambiente e chaves privadas mas permite .env.example", () => {
    const arquivosSensiveis = [
      ".env",
      ".env.local",
      ".env.production",
      "apps/api/.env.staging",
      "certs/server.pem",
      "keys/private.key",
      "certs/bundle.p12",
      "certs/cert.pfx",
      ".ssh/id_rsa",
      "id_ed25519",
      ".npmrc",
      "config/credentials.json",
      "service-account-prod.json",
    ];

    for (const caminho of arquivosSensiveis) {
      expect(deveIncluirArquivo(caminho), `deveria bloquear ${caminho}`).toBe(false);
    }

    expect(deveIncluirArquivo(".env.example")).toBe(true);
    expect(deveIncluirArquivo("apps/web/.env.template")).toBe(true);
  });

  it("mascara tokens GitHub, chaves OpenAI/Google/Supabase/AWS, JWTs, URLs com senha e PEM", () => {
    const diffComSegredos = [
      "+ const gh = 'ghp_1234567890abcdefghijklmnopqrstuv';",
      "+ const openai = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456';",
      "+ const google = 'AIzaSyD-1234567890abcdefghijklmnopqrstu';",
      "+ const supa = 'sb_secret_1234567890abcdef123456';",
      "+ const aws = 'AKIAIOSFODNN7EXAMPLE';",
      "+ const db = 'postgresql://admin:MinhaSenhaSuperSecreta@db.exemplo.com:5432/app';",
      '+ const cfg = { api_key: "segredo_muito_longo_12345" };',
      "+ -----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC\n-----END PRIVATE KEY-----",
    ].join("\n");

    const { textoSanitizado, totalSegredosMascarados } = sanitizarSegredosEmTexto(diffComSegredos);

    expect(totalSegredosMascarados).toBeGreaterThanOrEqual(8);
    expect(textoSanitizado).toContain(MARCADOR_SEGREDO_MASCARADO);
    expect(textoSanitizado).not.toContain("ghp_1234567890");
    expect(textoSanitizado).not.toContain("sk-proj-abcdef");
    expect(textoSanitizado).not.toContain("AIzaSyD-");
    expect(textoSanitizado).not.toContain("sb_secret_123456");
    expect(textoSanitizado).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(textoSanitizado).not.toContain("MinhaSenhaSuperSecreta");
    expect(textoSanitizado).not.toContain("segredo_muito_longo_12345");
    expect(textoSanitizado).not.toContain("BEGIN PRIVATE KEY");
  });
});
