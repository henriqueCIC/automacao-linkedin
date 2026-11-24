import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCollectionHistory } from "@/lib/collect.functions";
import { useAuth } from "@/hooks/useAuth";
import { isCollectionRunning } from "@/lib/collection-progress";

export const Route = createFileRoute("/coletas")({
  head: () => ({
    meta: [
      { title: "Histórico de coletas" },
      { name: "description", content: "Veja todas as execuções de coleta de commits." },
      { property: "og:title", content: "Histórico de coletas" },
      { property: "og:description", content: "Veja todas as execuções de coleta de commits." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ColetasPage,
});

function ColetasPage() {
  const { user } = useAuth();
  const { data: runs, isLoading } = useQuery({
    queryKey: ["collection-history", user?.id],
    queryFn: () => getCollectionHistory(),
    enabled: !!user,
  });

  return (
    <main className="paper-grain min-h-screen px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-8">
        <Button asChild variant="ghost" className="text-muted-foreground hover:text-foreground">
          <Link to="/">← Voltar ao diário</Link>
        </Button>
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-semibold text-foreground">Coletas</h1>
          <p className="text-muted-foreground">Histórico de cada busca por commits do GitHub.</p>
        </div>

        <Card className="border-border bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="font-display text-xl text-foreground">Execuções</CardTitle>
            <CardDescription className="text-muted-foreground">
              Quando a coleta rodou, quantos commits encontrou e se gerou um rascunho.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <p className="text-muted-foreground">Carregando…</p>
            ) : !runs?.length ? (
              <p className="text-muted-foreground">Nenhuma coleta registrada ainda.</p>
            ) : (
              runs.map((run) => (
                <div
                  key={run.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          run.status === "ok"
                            ? "default"
                            : isCollectionRunning(run.status)
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        {run.status === "ok"
                          ? "OK"
                          : isCollectionRunning(run.status)
                            ? "Em andamento"
                            : "Erro"}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{run.trigger}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {run.created_at
                        ? format(new Date(run.created_at), "PPp", { locale: ptBR })
                        : "—"}
                    </p>
                    <p className="text-sm text-foreground">
                      {isCollectionRunning(run.status)
                        ? "Busca em andamento"
                        : run.status === "erro" && run.commits_found === 0
                          ? "Busca não concluída"
                          : run.commits_found === 0
                            ? "Nenhum commit novo encontrado"
                            : `${run.commits_found} commit${run.commits_found === 1 ? "" : "s"} em ${
                                run.repositories?.length ?? 0
                              } repositório${run.repositories?.length === 1 ? "" : "s"}`}
                    </p>
                    {run.message && <p className="text-sm text-muted-foreground">{run.message}</p>}
                  </div>
                  {run.post_draft_id && (
                    <Button asChild variant="outline" size="sm">
                      <Link to="/rascunho/$id" params={{ id: run.post_draft_id }}>
                        Ver rascunho
                      </Link>
                    </Button>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
