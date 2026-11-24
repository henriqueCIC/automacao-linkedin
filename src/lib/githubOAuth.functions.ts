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
  saveAccountLogin,
} from "./appUserConnections.server";

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
    const state = Buffer.from(JSON.stringify({ userId: context.userId, ts: Date.now() })).toString(
      "base64",
    );
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: returnUrl,
      scope: GITHUB_SCOPES.join(" "),
      state,
    });
    const authorizationUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
    return { authorizationUrl };
  });

export const completeGitHubOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ code: z.string() }))
  .handler(async ({ data, context }) => {
    const { clientId, clientSecret } = getGitHubCredentials();
    const returnUrl = buildReturnUrl();

    // Troca o código pelo access_token na API oficial do GitHub
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
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
      const errBody = await tokenRes.text();
      console.error("Falha na troca do código de autorização do GitHub:", errBody);
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
    let accountLogin: string | null = null;
    try {
      const userRes = await fetch("https://api.github.com/user", {
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
