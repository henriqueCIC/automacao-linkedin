import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  checkPublishedPost,
  getLinkedInStatus,
  publishApprovedDraft,
} from "@/lib/linkedin.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/publicacoes")({
  head: () => ({
    meta: [
      { title: "Publicações no LinkedIn e status de cada post" },
      {
        name: "description",
        content:
          "Veja os textos aprovados prontos para publicar, publique com confirmação final e acompanhe o status de cada publicação no LinkedIn.",
      },
      { property: "og:title", content: "Publicações no LinkedIn e status de cada post" },
      {
        property: "og:description",
        content: "Publique os textos aprovados e acompanhe o status de cada post publicado.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PublicationsPage,
});

const STATE_LABEL: Record<string, string> = {
  PUBLISHED: "Publicado e visível",
  DRAFT: "Rascunho no LinkedIn",
  PROCESSING: "Em processamento no LinkedIn",
  PROCESSING_FAILED: "Falhou no LinkedIn",
  nao_publicado: "Sem registro de publicação",
  sem_autorizacao: "Autorização do LinkedIn indisponível",
  indisponivel: "Não foi possível consultar agora",
};

function PublicationsPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const runStatus = useServerFn(getLinkedInStatus);
  const runPublish = useServerFn(publishApprovedDraft);
  const runCheck = useServerFn(checkPublishedPost);

  const [checks, setChecks] = useState<
    Record<string, { state: string; url: string | null; checkedAt: string }>
  >({});

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const userId = session?.user.id;

  const linkedIn = useQuery({
    enabled: Boolean(userId),
    queryKey: ["linkedin-status", userId],
    queryFn: () => runStatus({}),
  });

  const posts = useQuery({
    enabled: Boolean(userId),
    queryKey: ["post_drafts", "publicacoes", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("post_drafts")
        .select("id, content, summary, status, approved_at, published_at, linkedin_post_id")
        .eq("user_id", userId!)
        .in("status", ["aprovado", "publicado"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const publish = useMutation({
    mutationFn: (draftId: string) => runPublish({ data: { draftId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["post_drafts"] });
      toast.success("Publicado no LinkedIn.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível publicar."),
  });

  const check = useMutation({
    mutationFn: (draftId: string) => runCheck({ data: { draftId } }),
    onSuccess: (result, draftId) => {
      setChecks((current) => ({
        ...current,
        [draftId]: { state: result.state, url: result.url, checkedAt: result.checkedAt },
      }));
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível conferir o status."),
  });

  if (loading || !session) {
    return (
      <main className="paper-grain flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </main>
    );
  }

  const connected = linkedIn.data?.connected === true;
  const approved = posts.data?.filter((p) => p.status === "aprovado") ?? [];
  const published = posts.data?.filter((p) => p.status === "publicado") ?? [];

  return (
    <main className="paper-grain min-h-screen">
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-4 px-6 py-5">
          <Button asChild variant="ghost">
            <Link to="/">← Voltar ao diário</Link>
          </Button>
          <Link to="/" className="font-display text-2xl text-primary">
            Diário → LinkedIn
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-3xl">Conta do LinkedIn</CardTitle>
            <CardDescription>
              {linkedIn.isLoading
                ? "Conferindo a autorização…"
                : connected
                  ? `Autorizada${linkedIn.data?.name ? `: ${linkedIn.data.name}` : ""}. Cada publicação ainda exige a sua confirmação final.`
                  : "Nenhuma conta autorizada. Enquanto isso, a publicação fica bloqueada e você pode copiar o texto manualmente."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              onClick={() => void linkedIn.refetch()}
              disabled={linkedIn.isFetching}
            >
              {linkedIn.isFetching ? "Conferindo…" : "Conferir autorização"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-2xl">Prontos para publicar</CardTitle>
            <CardDescription>
              Textos que você já aprovou na tela de revisão. Publicar pede uma confirmação final.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {approved.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum texto aprovado agora. Aprove um rascunho para liberar a publicação.
              </p>
            )}
            {approved.map((post) => (
              <div key={post.id} className="rounded-md border border-border bg-background p-4">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary">Aprovado por você</Badge>
                  {post.approved_at && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(post.approved_at as string).toLocaleString("pt-BR")}
                    </span>
                  )}
                </div>
                <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-foreground/80">
                  {post.content as string}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/rascunho/$id" params={{ id: post.id }}>
                      Rever o texto
                    </Link>
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" disabled={!connected || publish.isPending}>
                        {publish.isPending ? "Publicando…" : "Publicar agora"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Publicar este texto no LinkedIn?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Será publicado exatamente o texto abaixo, na sua conta autorizada.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="max-h-56 overflow-y-auto whitespace-pre-line rounded-md border border-border bg-muted/40 p-3 text-sm">
                        {post.content as string}
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => publish.mutate(post.id)}>
                          Confirmar publicação
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-2xl">Histórico de publicações</CardTitle>
            <CardDescription>
              Confira quando cada post foi enviado e o status atual dele no LinkedIn.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {published.length === 0 && (
              <p className="text-sm text-muted-foreground">Nada publicado ainda.</p>
            )}
            {published.map((post) => {
              const info = checks[post.id];
              return (
                <div key={post.id} className="rounded-md border border-border bg-background p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge>Publicado</Badge>
                    {post.published_at && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(post.published_at as string).toLocaleString("pt-BR")}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm text-foreground/80">
                    {post.content as string}
                  </p>
                  {info && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {STATE_LABEL[info.state] ?? info.state} · conferido às{" "}
                      {new Date(info.checkedAt).toLocaleTimeString("pt-BR")}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => check.mutate(post.id)}
                      disabled={check.isPending}
                    >
                      {check.isPending ? "Conferindo…" : "Conferir status"}
                    </Button>
                    {post.linkedin_post_id && (
                      <Button asChild variant="ghost" size="sm">
                        <a
                          href={`https://www.linkedin.com/feed/update/${post.linkedin_post_id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Ver no LinkedIn
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
