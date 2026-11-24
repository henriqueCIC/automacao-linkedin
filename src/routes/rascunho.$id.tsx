import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { refineDraft } from "@/lib/drafts.functions";
import { getLinkedInStatus, publishApprovedDraft } from "@/lib/linkedin.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

export const Route = createFileRoute("/rascunho/$id")({
  head: () => ({
    meta: [
      { title: "Revisar rascunho antes de publicar" },
      {
        name: "description",
        content:
          "Leia o resumo do dia, edite o texto do post, peça ajustes e aprove antes de publicar no LinkedIn.",
      },
      { property: "og:title", content: "Revisar rascunho antes de publicar" },
      {
        property: "og:description",
        content: "Resumo do dia, texto do post e aprovação explícita antes de qualquer publicação.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DraftPage,
});

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Aguardando sua revisão",
  aprovado: "Aguardando envio (aprovado)",
  publicando: "Em publicação / confirmar no LinkedIn",
  rejeitado: "Rejeitado",
  publicado: "Publicado no LinkedIn",
};

function DraftPage() {
  const { id } = Route.useParams();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const runRefine = useServerFn(refineDraft);
  const runPublish = useServerFn(publishApprovedDraft);
  const runStatus = useServerFn(getLinkedInStatus);

  const [content, setContent] = useState("");
  const [feedback, setFeedback] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  const userId = session?.user.id;

  const draft = useQuery({
    enabled: Boolean(userId),
    queryKey: ["draft", userId, id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("post_drafts")
        .select(
          "id, summary, content, status, tone, feedback, published_at, day_entries(entry_date, raw_notes)",
        )
        .eq("id", id)
        .eq("user_id", userId!)
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const linkedIn = useQuery({
    enabled: Boolean(userId),
    queryKey: ["linkedin-status", userId],
    queryFn: () => runStatus({}),
  });

  useEffect(() => {
    if (draft.data && !dirty) setContent(draft.data.content as string);
  }, [draft.data, dirty]);

  const setStatus = useMutation({
    mutationFn: async (status: "aprovado" | "rejeitado" | "rascunho") => {
      const { error } = await supabase
        .from("post_drafts")
        .update({
          content,
          status,
          approved_at: status === "aprovado" ? new Date().toISOString() : null,
        })
        .eq("id", id)
        .eq("user_id", userId!);
      if (error) throw new Error(error.message);
      return status;
    },
    onSuccess: async (status) => {
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["draft", userId, id] });
      await queryClient.invalidateQueries({ queryKey: ["post_drafts"] });
      toast.success(
        status === "aprovado"
          ? "Aprovado. Agora você pode publicar quando quiser."
          : status === "rejeitado"
            ? "Rascunho rejeitado."
            : "Alterações salvas.",
      );
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Algo deu errado."),
  });

  const refine = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("post_drafts")
        .update({ content })
        .eq("id", id)
        .eq("user_id", userId!);
      if (error) throw new Error(error.message);
      return runRefine({ data: { draftId: id, feedback } });
    },
    onSuccess: async () => {
      setFeedback("");
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ["draft", userId, id] });
      toast.success("Nova versão gerada com o seu complemento.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Algo deu errado."),
  });

  const publish = useMutation({
    mutationFn: () => runPublish({ data: { draftId: id } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["draft", userId, id] });
      await queryClient.invalidateQueries({ queryKey: ["post_drafts"] });
      toast.success("Publicado no LinkedIn.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível publicar."),
  });

  if (loading || draft.isLoading) {
    return (
      <main className="paper-grain flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </main>
    );
  }

  if (draft.error || !draft.data) {
    return (
      <main className="paper-grain flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">Rascunho não encontrado.</p>
        <Button asChild variant="outline">
          <Link to="/">Voltar</Link>
        </Button>
      </main>
    );
  }

  const status = draft.data.status as string;
  const entry = draft.data.day_entries as { entry_date?: string; raw_notes?: string } | null;
  const approved = status === "aprovado";
  const published = status === "publicado";
  const connected = linkedIn.data?.connected === true;

  return (
    <main className="paper-grain min-h-screen">
      <header className="border-b border-border bg-card/60">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
          <Link to="/" className="font-display text-2xl text-primary">
            Diário → LinkedIn
          </Link>
          <div className="flex items-center gap-3">
            <Badge variant={published ? "default" : "secondary"}>
              {STATUS_LABEL[status] ?? status}
            </Badge>
            <Button asChild variant="outline" size="sm">
              <Link to="/publicacoes">Publicações</Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-3xl">Resumo do dia</CardTitle>
            <CardDescription>
              {entry?.entry_date
                ? new Date(`${entry.entry_date}T12:00:00`).toLocaleDateString("pt-BR", {
                    dateStyle: "long",
                  })
                : "Sem data"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/85">
              {draft.data.summary as string}
            </p>
            {entry?.raw_notes && (
              <details className="rounded-md border border-border/70 p-3 text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  Ver as anotações originais
                </summary>
                <p className="mt-2 whitespace-pre-line text-muted-foreground">{entry.raw_notes}</p>
              </details>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-3xl">Texto do post</CardTitle>
            <CardDescription>
              Este é exatamente o texto que será publicado. Edite livremente — nada vai ao ar sem a
              sua aprovação.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              rows={14}
              value={content}
              disabled={published}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
              }}
            />
            <p className="text-xs text-muted-foreground">{content.length} caracteres</p>

            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(content);
                  toast.success("Texto copiado.");
                }}
              >
                Copiar texto
              </Button>
              {!published && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setStatus.mutate("rascunho")}
                    disabled={setStatus.isPending}
                  >
                    Salvar alterações
                  </Button>
                  <Button
                    onClick={() => setStatus.mutate("aprovado")}
                    disabled={setStatus.isPending}
                  >
                    {approved ? "Aprovar novamente" : "Aprovar este texto"}
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setStatus.mutate("rejeitado")}
                    disabled={setStatus.isPending}
                  >
                    Rejeitar
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {!published && (
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-2xl">Complementar o que foi feito</CardTitle>
              <CardDescription>
                Conte o que ficou de fora ou o que deve mudar e uma nova versão é gerada para nova
                revisão.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                rows={4}
                placeholder="Ex.: faltou citar que a entrega foi em equipe e deixe o tom menos formal."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
              <Button
                variant="secondary"
                onClick={() => refine.mutate()}
                disabled={refine.isPending || feedback.trim().length < 5}
              >
                {refine.isPending ? "Reescrevendo…" : "Gerar nova versão"}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="font-display text-2xl">Publicar no LinkedIn</CardTitle>
            <CardDescription>
              {published
                ? "Este post já foi publicado."
                : connected
                  ? `Conta autorizada${linkedIn.data?.name ? `: ${linkedIn.data.name}` : ""}. A publicação só acontece depois da sua aprovação e confirmação.`
                  : "Nenhuma conta do LinkedIn autorizada ainda. A publicação fica bloqueada até você autorizar."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!published && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={!approved || !connected || dirty || publish.isPending}>
                    {publish.isPending ? "Publicando…" : "Publicar agora"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Publicar este texto no LinkedIn?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Será publicado exatamente o texto aprovado acima, na sua conta autorizada.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="max-h-56 overflow-y-auto whitespace-pre-line rounded-md border border-border bg-muted/40 p-3 text-sm">
                    {content}
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => publish.mutate()}>
                      Confirmar publicação
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {!published && (!approved || dirty) && (
              <p className="mt-3 text-xs text-muted-foreground">
                {dirty
                  ? "Você editou o texto: salve e aprove novamente para liberar a publicação."
                  : "Aprove o texto acima para liberar a publicação."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
