import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { completeGitHubOAuth } from "@/lib/githubOAuth.functions";

export const Route = createFileRoute("/oauth/github/return")({
  head: () => ({
    meta: [
      { title: "Conectando GitHub…" },
      { name: "description", content: "Finalizando a conexão com o GitHub." },
      { property: "og:title", content: "Conectando GitHub…" },
      { property: "og:description", content: "Finalizando a conexão com o GitHub." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OAuthReturnPage,
});

function OAuthReturnPage() {
  const [status, setStatus] = useState<"processando" | "ok" | "erro">("processando");
  const [message, setMessage] = useState("Finalizando a conexão com o GitHub…");
  const complete = useServerFn(completeGitHubOAuth);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error") || params.get("error_description");

    if (error) {
      setStatus("erro");
      setMessage(error ?? "A autorização com o GitHub não foi concluída.");
      if (window.opener) {
        window.opener.postMessage(
          { type: "githubOAuthFailed", connectorId: "github" },
          window.location.origin,
        );
      }
      return;
    }

    if (!code || !state) {
      setStatus("erro");
      setMessage("Parâmetros de autorização do GitHub incompletos (código ou estado ausente).");
      if (window.opener) {
        window.opener.postMessage(
          { type: "githubOAuthFailed", connectorId: "github" },
          window.location.origin,
        );
      }
      return;
    }

    complete({ data: { code, state } })
      .then(() => {
        setStatus("ok");
        setMessage("GitHub conectado com sucesso. Você já pode buscar seus commits.");
        if (window.opener) {
          window.opener.postMessage(
            { type: "githubOAuthComplete", connectorId: "github" },
            window.location.origin,
          );
          setTimeout(() => window.close(), 600);
        }
      })
      .catch((err: unknown) => {
        setStatus("erro");
        setMessage(err instanceof Error ? err.message : "Erro ao salvar a conexão com o GitHub.");
        if (window.opener) {
          window.opener.postMessage(
            { type: "githubOAuthFailed", connectorId: "github" },
            window.location.origin,
          );
        }
      });
  }, [complete]);

  return (
    <main className="paper-grain flex min-h-screen items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-display text-2xl">
            {status === "erro" ? "Algo deu errado" : "GitHub"}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link to="/fontes">{status === "ok" ? "Ir para Fontes" : "Voltar para Fontes"}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
