import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  GITHUB_CONNECTOR_ID,
  GITHUB_SCOPES,
  saveConnectionKeyForUser,
  getConnectionForUser,
  deleteConnectionForUser,
} from "./appUserConnections.server";
import { gerarStateOAuth, validarStateOAuth } from "./oauthState.server";

function getGitHubCredentials() {
  const clientId = process.env["GITHUB_CLIENT_ID"];
  const clientSecret = process.env["GITHUB_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error(
      "Credenciais do GitHub OAuth ausentes no .env. Configure GITHUB_CLIENT_ID e GITHUB_CLIENT_SECRET.",
    );
  }
  return { clientId, clientSecret };
}

function buildReturnUrl(): string {
  const request = getRequest();
  if (!request) throw new Error("OAuth deve iniciar a partir de uma requisição.");
  const url = new URL(request.url);
  const sandboxHost = url.hostname === "localhost" ? request.headers.get("x-forwarded-host") : null;
  const origin = sandboxHost ? `https://${sandboxHost}` : url.origin;
  return `${origin}/oauth/github/return`;
}

export const startGitHubOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { clientId } = getGitHubCredentials();
    const returnUrl = buildReturnUrl();
    const state = gerarStateOAuth(context.userId);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: returnUrl,
      scope: GITHUB_SCOPES.join(" "),
      state,
    });
    const authorizeBase =
      process.env["GITHUB_OAUTH_AUTHORIZE_URL"]?.trim() ||
      "https://github.com/login/oauth/authorize";
    const authorizationUrl = `${authorizeBase}?${params.toString()}`;
    return { authorizationUrl };
  });

export const completeGitHubOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    z.object({
      code: z.string().trim().min(1, "Código de autorização do GitHub ausente."),
      state: z.string().trim().min(1, "Estado de segurança OAuth ausente."),
    }),
  )
  .handler(async ({ data, context }) => {
    // Valida assinatura HMAC-SHA256, correspondência de userId e janela de expiração (S02)
    validarStateOAuth(data.state, context.userId);

    const { clientId, clientSecret } = getGitHubCredentials();
    const returnUrl = buildReturnUrl();

    // Troca o código pelo access_token na API oficial do GitHub (ou endpoint simulado local)
    const tokenEndpoint =
      process.env["GITHUB_OAUTH_TOKEN_URL"]?.trim() ||
      "https://github.com/login/oauth/access_token";
    const tokenRes = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: data.code,
        redirect_uri: returnUrl,
      }),
    });

    if (!tokenRes.ok) {
      console.error(`Falha na troca do código de autorização do GitHub [HTTP ${tokenRes.status}]`);
      throw new Error("Falha ao trocar código de autorização com o GitHub.");
    }

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (tokenData.error || !tokenData.access_token) {
      throw new Error(
        tokenData.error_description || tokenData.error || "Token do GitHub não retornado.",
      );
    }

    // Busca o login do usuário no GitHub
    const githubApiBase = (
      process.env["GITHUB_API_BASE_URL"]?.trim() || "https://api.github.com"
    ).replace(/\/+$/, "");
    let accountLogin: string | null = null;
    try {
      const userRes = await fetch(`${githubApiBase}/user`, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Automacao-LinkedIn-App",
        },
      });
      if (userRes.ok) {
        const userInfo = (await userRes.json()) as { login?: string };
        accountLogin = userInfo.login ?? null;
      }
    } catch (e) {
      console.warn("Não foi possível consultar o login do usuário:", e);
    }

    await saveConnectionKeyForUser(
      context.userId,
      GITHUB_CONNECTOR_ID,
      tokenData.access_token,
      accountLogin,
    );
    return { ok: true };
  });

export const getGitHubStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const connection = await getConnectionForUser(context.userId, GITHUB_CONNECTOR_ID);
    if (!connection) return { connected: false as const, reconnectRequired: false as const };
    return {
      connected: true as const,
      accountLogin: connection.accountLogin,
      reconnectRequired: connection.reconnectRequired,
    };
  });

export const disconnectGitHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await deleteConnectionForUser(context.userId, GITHUB_CONNECTOR_ID);
    return { ok: true };
  });
