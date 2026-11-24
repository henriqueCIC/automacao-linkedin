import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getGitHubStatus, startGitHubOAuth, disconnectGitHub } from "@/lib/githubOAuth.functions";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/fontes")({
  head: () => ({
    meta: [
      { title: "Fontes de alterações" },
      { name: "description", content: "Conecte o GitHub para coletar commits automaticamente." },
      { property: "og:title", content: "Fontes de alterações" },
      {
        property: "og:description",
        content: "Conecte o GitHub para coletar commits automaticamente.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FontesPage,
});

function FontesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ["github-status", user?.id],
    queryFn: () => getGitHubStatus(),
    enabled: !!user,
  });

  const startOAuth = useServerFn(startGitHubOAuth);
  const disconnect = useServerFn(disconnectGitHub);

  const connectMutation = useMutation({
    mutationFn: async () => {
      const { authorizationUrl } = await startOAuth();
      const popup = window.open("", "github-oauth", "width=600,height=720");
      if (!popup) throw new Error("Popup bloqueado. Permita popups e tente de novo.");

      const completion = waitForOAuthCompletion(popup);
      popup.location.href = authorizationUrl;
      await completion;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["github-status", user?.id] });
      setMessage("GitHub conectado com sucesso.");
    },
    onError: (err: Error) => setMessage(err.message),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => disconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["github-status", user?.id] });
      setMessage("GitHub desconectado.");
    },
    onError: (err: Error) => setMessage(err.message),
  });

  return (
    <main className="paper-grain min-h-screen px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-8">
        <Button asChild variant="ghost" className="text-muted-foreground hover:text-foreground">
          <Link to="/">← Voltar ao diário</Link>
        </Button>
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-semibold text-foreground">Fontes</h1>
          <p className="text-muted-foreground">
            Escolha de onde as mudanças do dia serão coletadas.
          </p>
        </div>

        {message && (
          <Alert className="border-border bg-card">
            <AlertTitle className="text-foreground">Aviso</AlertTitle>
            <AlertDescription className="text-muted-foreground">{message}</AlertDescription>
          </Alert>
        )}

        <Card className="border-border bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="font-display text-xl text-foreground">GitHub</CardTitle>
            <CardDescription className="text-muted-foreground">
              O app consulta seus commits em todos os repositórios onde você commitou hoje. Arquivos
              locais do VS Code não podem ser lidos pelo navegador, por isso a fonte é o GitHub.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <p className="text-muted-foreground">Carregando…</p>
            ) : status?.connected ? (
              <>
                <p className="text-foreground">
                  Conta conectada:{" "}
                  <span className="font-medium text-primary">
                    {status.accountLogin ?? "(desconhecido)"}
                  </span>
                </p>
                {status.reconnectRequired && (
                  <Alert variant="destructive" className="border-destructive/30 bg-card">
                    <AlertTitle>Reconexão necessária</AlertTitle>
                    <AlertDescription>
                      Sua autorização com o GitHub expirou. Clique em reconectar.
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => connectMutation.mutate()}
                    disabled={connectMutation.isPending}
                    variant="outline"
                  >
                    {status.reconnectRequired ? "Reconectar GitHub" : "Trocar conta"}
                  </Button>
                  <Button
                    onClick={() => disconnectMutation.mutate()}
                    disabled={disconnectMutation.isPending}
                    variant="ghost"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Desconectar
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-muted-foreground">
                  Conecte sua conta do GitHub para que o app possa ler seus commits e gerar
                  rascunhos de post.
                </p>
                <Button
                  onClick={() => connectMutation.mutate()}
                  disabled={connectMutation.isPending}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {connectMutation.isPending ? "Abrindo GitHub…" : "Conectar com o GitHub"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card/60 shadow-sm">
          <CardHeader>
            <CardTitle className="font-display text-xl text-foreground">Outras fontes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              No futuro será possível usar uma extensão do VS Code ou importar atividade
              manualmente. Por enquanto, a fonte automática é o GitHub.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function waitForOAuthCompletion(popup: Window): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== popup ||
        event.data?.connectorId !== "github" ||
        (event.data?.type !== "githubOAuthComplete" && event.data?.type !== "githubOAuthFailed")
      )
        return;
      cleanup();
      if (event.data.type === "githubOAuthComplete") {
        resolve();
      } else {
        popup.close();
        reject(new Error("A autorização com o GitHub foi cancelada ou falhou."));
      }
    };
    const poll = window.setInterval(() => {
      if (!popup.closed) return;
      cleanup();
      reject(new Error("A janela de autorização foi fechada antes de terminar."));
    }, 500);
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(poll);
    };
    window.addEventListener("message", onMessage);
  });
}
