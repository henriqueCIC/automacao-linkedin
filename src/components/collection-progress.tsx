import { Check, Circle, CircleAlert, LoaderCircle } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { COLLECTION_STEPS } from "@/lib/collection-progress";

export type CollectionProgressState = {
  status: string;
  message: string | null;
  commits_found: number;
  repositories: string[];
};

export function CollectionProgress({ run, pending, failed }: {
  run: CollectionProgressState | null;
  pending: boolean;
  failed: boolean;
}) {
  const activeIndex = COLLECTION_STEPS.findIndex((step) => step.status === run?.status);
  const done = run?.status === "ok";
  const error = failed || run?.status === "erro";
  const empty = done && run.commits_found === 0;
  const heading = error ? "Não foi possível concluir a busca" : empty
    ? "Busca concluída · nenhum commit novo" : done
      ? "Rascunho pronto para revisão" : "Buscando sua atividade no GitHub";

  return (
    <section aria-label="Progresso da busca de commits" className="space-y-3 border-l-2 border-commits pl-4 py-2">
      <div role="status" aria-live="polite" aria-atomic="true">
        <p className="text-sm font-medium text-foreground">{heading}</p>
        <p className={`mt-1 break-words text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}>
          {run?.message ?? "Iniciando a busca…"}
        </p>
      </div>
      <ol className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {COLLECTION_STEPS.map((step, index) => {
          const complete = done ? (!empty || index < 3) : activeIndex > index;
          const active = !error && !done && pending && (activeIndex === index || (!run && index === 0));
          const Icon = complete ? Check : active ? LoaderCircle : error && (activeIndex === index || (activeIndex < 0 && index === 0)) ? CircleAlert : Circle;
          return (
            <li key={step.status} className={`flex min-w-0 items-center gap-2 text-xs ${complete ? "text-primary" : active ? "text-foreground" : "text-muted-foreground"}`}>
              <Icon aria-hidden="true" className={`size-4 shrink-0 ${active ? "motion-safe:animate-spin" : ""}`} />
              <span>{step.label}{empty && index >= 3 ? " · não necessário" : ""}</span>
            </li>
          );
        })}
      </ol>
      {!!run?.repositories.length && (
        <p className="break-words text-xs text-muted-foreground">Repositórios com atividade: {run.repositories.join(", ")}</p>
      )}
      {error && /não conectado|expirou|autorização/i.test(run?.message ?? "") && (
        <Button asChild variant="outline" size="sm"><Link to="/fontes">Conectar conta GitHub</Link></Button>
      )}
    </section>
  );
}