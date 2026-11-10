import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { generateDraft } from "@/lib/drafts.functions";
import { getGitHubCollectionStatus, runCollectionNow } from "@/lib/collect.functions";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { CollectionProgress, type CollectionProgressState } from "@/components/collection-progress";
import { isCollectionRunning } from "@/lib/collection-progress";
import { GitCommitHorizontal } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Diário do dia → rascunhos de posts para LinkedIn" },
      {
        name: "description",
        content:
          "Registre ou importe as mudanças do seu dia, receba um resumo e um rascunho de post para o LinkedIn, revise, aprove e publique.",
      },
      { property: "og:title", content: "Diário do dia → rascunhos de posts para LinkedIn" },
      {
        property: "og:description",
        content:
          "Registre o dia, revise o resumo e o rascunho, aprove e publique no LinkedIn com sua autorização.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const TONES = [
  { value: "profissional", label: "Profissional e direto" },
  { value: "narrativo", label: "Narrativa pessoal" },
  { value: "tecnico", label: "Técnico detalhado" },
];

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Aguardando revisão",
  aprovado: "Aprovado por você",
  rejeitado: "Rejeitado",
  publicado: "Publicado",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function Home() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <main className="paper-grain flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </main>
    );
  }

  const metadataName = session.user.user_metadata?.["full_name"] ?? session.user.user_metadata?.["name"];
  const emailName = (session.user.email?.split("@")[0] ?? "Usuário")
    .replace(/[._-]+/g, " ")
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("pt-BR"));
  const displayName = typeof metadataName === "string" && metadataName.trim()
    ? metadataName.trim()
    : emailName;
  return <Dashboard userId={session.user.id} displayName={displayName} />;
}

function Dashboard({ userId, displayName }: { userId: string; displayName: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const runGenerate = useServerFn(generateDraft);
  const runCollect = useServerFn(runCollectionNow);

  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(today());
  const [tone, setTone] = useState("profissional");
  const [collectionRunId, setCollectionRunId] = useState<string | null>(null);
  const [collectionResult, setCollectionResult] = useState<CollectionProgressState | null>(null);

  const entries = useQuery({
    queryKey: ["day_entries", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("day_entries")
        .select("id, entry_date, raw_notes, source, created_at")
        .order("entry_date", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const drafts = useQuery({
    queryKey: ["post_drafts", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("post_drafts")
        .select("id, summary, content, status, tone, created_at, published_at")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const collectionStatus = useQuery({
    queryKey: ["collection-status", userId],
    queryFn: () => getGitHubCollectionStatus(),
  });

  const collectNow = useMutation({
    mutationFn: (runId: string) => runCollect({ data: { runId } }),
    onSuccess: async (result) => {
      setCollectionResult({ status: result.status, message: result.message ?? null, commits_found: result.commitsFound, repositories: result.repositories });
      await queryClient.invalidateQueries({ queryKey: ["collection-status", userId] });
      await queryClient.invalidateQueries({ queryKey: ["day_entries", userId] });
      await queryClient.invalidateQueries({ queryKey: ["post_drafts", userId] });
      await queryClient.invalidateQueries({ queryKey: ["collection-history", userId] });
      if (result.status === "erro") {
        toast.error(result.message ?? "Não foi possível concluir a busca.");
      } else if (result.postDraftId) {
        toast.success("Coleta concluída. Um novo rascunho foi gerado.");
        void navigate({ to: "/rascunho/$id", params: { id: result.postDraftId } });
      } else {
        toast(result.commitsFound === 0 ? "Nenhum commit novo encontrado." : "Coleta concluída sem rascunho.");
      }
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Erro na coleta.";
      setCollectionResult({ status: "erro", message, commits_found: 0, repositories: [] });
      toast.error(message);
    },
  });

  const collectionProgress = useQuery({
    queryKey: ["collection-progress", userId, collectionRunId],
    enabled: !!collectionRunId && collectNow.isPending,
    queryFn: async () => {
      if (!collectionRunId) return null;
      const { data, error } = await supabase.from("collection_runs")
        .select("status, message, commits_found, repositories")
        .eq("user_id", userId).eq("id", collectionRunId).maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: collectNow.isPending ? 600 : false,
    retry: 1,
  });

  const save = useMutation({
    mutationFn: async ({ source }: { source: string }) => {
      const text = notes.trim();
      if (text.length < 15) throw new Error("Escreva um pouco mais sobre o que mudou hoje.");
      const { data: entry, error } = await supabase
        .from("day_entries")
        .insert({ user_id: userId, entry_date: date, raw_notes: text, source })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const result = await runGenerate({ data: { entryId: entry.id, tone } });
      return result.id;
    },
    onSuccess: async (draftId) => {
      setNotes("");
      await queryClient.invalidateQueries({ queryKey: ["day_entries", userId] });
      await queryClient.invalidateQueries({ queryKey: ["post_drafts", userId] });
      toast.success("Resumo e rascunho gerados. Revise antes de publicar.");
      void navigate({ to: "/rascunho/$id", params: { id: draftId } });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Algo deu errado."),
  });

  async function onImportFile(file: File) {
    const text = await file.text();
    setNotes((current) => (current ? `${current}\n${text}` : text).slice(0, 8000));
    toast.success("Arquivo importado para as anotações do dia.");
  }

  return (
    <main className="paper-grain min-h-screen">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="font-display text-3xl text-foreground">Diário <span className="text-primary">→</span> LinkedIn</p>
            <p className="mt-1 break-words text-sm text-muted-foreground">Bem-vindo: <span className="font-medium text-foreground">{displayName}</span></p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/fontes">Fontes</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/configuracoes">Configurações</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/coletas">Coletas</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/publicacoes">Publicações</Link>
            </Button>
            <div className="ml-1 flex shrink-0 items-center gap-1 border-l border-border pl-2">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await supabase.auth.signOut();
                void navigate({ to: "/auth" });
              }}
            >
              Sair
            </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-3xl">O que mudou hoje?</CardTitle>
            <CardDescription>
              Escreva em tópicos soltos, importe um arquivo ou busque seus commits do GitHub. Nada
              é publicado sem a sua aprovação.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {collectionStatus.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando status da automação…</p>
            ) : collectionStatus.data?.settings?.enabled && collectionStatus.data?.lastRun ? (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm text-foreground">
                Última coleta:{" "}
                {new Date(collectionStatus.data.lastRun.created_at as string).toLocaleString(
                  "pt-BR",
                )}
                {" — "}
                 {isCollectionRunning(collectionStatus.data.lastRun.status)
                   ? "coleta em andamento"
                   : collectionStatus.data.lastRun.status === "erro"
                   ? "coleta não concluída"
                   : collectionStatus.data.lastRun.commits_found === 0
                  ? "nenhum commit novo"
                  : `${collectionStatus.data.lastRun.commits_found} commits achados`}
                {collectionStatus.data.lastRun.status !== "ok" &&
                  ` (${collectionStatus.data.lastRun.message ?? "erro"})`}
              </div>
            ) : collectionStatus.data?.settings?.enabled ? (
              <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                Coleta automática ativa, mas ainda não rodou hoje.
              </div>
            ) : null}

            <Button
              onClick={() => {
                const runId = crypto.randomUUID();
                setCollectionRunId(runId);
                setCollectionResult(null);
                collectNow.mutate(runId);
              }}
              disabled={collectNow.isPending}
              variant="commits"
              className="w-full sm:w-auto"
            >
              <GitCommitHorizontal />
              {collectNow.isPending ? "Buscando commits…" : "Buscar meus commits agora"}
            </Button>
            {collectionRunId && (
              <>
                <CollectionProgress run={collectionResult ?? collectionProgress.data ?? null} pending={collectNow.isPending} failed={collectNow.isError} />
                {collectionProgress.isError && collectNow.isPending && <p role="status" className="text-xs text-warning">Não foi possível atualizar as etapas. Aguardando o resultado da busca…</p>}
              </>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="date">Dia</Label>
                <Input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tone">Estilo do post</Label>
                <Select value={tone} onValueChange={setTone}>
                  <SelectTrigger id="tone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TONES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">Mudanças do dia</Label>
              <Textarea
                id="notes"
                rows={10}
                placeholder={"- ajustei o fluxo de cadastro\n- reunião com o time de vendas\n- aprendi X sobre Y"}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => save.mutate({ source: "manual" })} disabled={save.isPending}>
                {save.isPending ? "Gerando…" : "Gerar resumo e rascunho"}
              </Button>
              <Label
                htmlFor="import"
                className="cursor-pointer text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Importar de um arquivo (.txt, .md, .csv)
              </Label>
              <input
                id="import"
                type="file"
                accept=".txt,.md,.csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onImportFile(file);
                  e.target.value = "";
                }}
              />
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-2xl">Seus rascunhos</CardTitle>
              <CardDescription>Revise, edite, aprove ou rejeite cada um.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {drafts.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
              {drafts.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nenhum rascunho ainda. Registre o seu dia ao lado.
                </p>
              )}
              {drafts.data?.map((draft) => (
                <Link
                  key={draft.id}
                  to="/rascunho/$id"
                  params={{ id: draft.id }}
                  className="block rounded-md border border-border bg-background p-3 transition-colors hover:border-primary"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={draft.status === "publicado" ? "default" : "secondary"}>
                      {STATUS_LABEL[draft.status] ?? draft.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(draft.created_at as string).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm text-foreground/80">
                    {draft.summary || draft.content}
                  </p>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-display text-2xl">Registros recentes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {entries.data?.length === 0 && (
                <p className="text-sm text-muted-foreground">Nada registrado por enquanto.</p>
              )}
              {entries.data?.map((entry) => (
                <div key={entry.id} className="rounded-md border border-border/70 p-3">
                  <p className="text-xs font-medium text-primary">
                    {new Date(`${entry.entry_date}T12:00:00`).toLocaleDateString("pt-BR")}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{entry.raw_notes}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
