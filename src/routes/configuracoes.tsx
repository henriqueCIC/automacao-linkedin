import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getAutomationSettings, updateAutomationSettings } from "@/lib/collect.functions";
import { FUSOS_HORARIOS_SUPORTADOS, normalizarFusoHorario } from "@/lib/timezone";
import { useAuth } from "@/hooks/useAuth";

const TIMEZONES = FUSOS_HORARIOS_SUPORTADOS;

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações da automação" },
      {
        name: "description",
        content: "Configure horário, fuso e estilo da coleta automática de commits.",
      },
      { property: "og:title", content: "Configurações da automação" },
      {
        property: "og:description",
        content: "Configure horário, fuso e estilo da coleta automática de commits.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConfiguracoesPage,
});

type TomAutomacao = "profissional" | "narrativo" | "tecnico";

function ConfiguracoesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    enabled: true,
    dailyTime: "18:00",
    timezone: "America/Bahia",
    defaultTone: "profissional" as TomAutomacao,
    maxCommitsPerDay: 15,
    notifyDesktop: true,
    notifyEmail: false,
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ["automation-settings", user?.id],
    queryFn: () => getAutomationSettings(),
    enabled: !!user,
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      enabled: settings.enabled,
      dailyTime: settings.daily_time.slice(0, 5),
      timezone: normalizarFusoHorario(settings.timezone),
      defaultTone: settings.default_tone as TomAutomacao,
      maxCommitsPerDay: settings.max_commits_per_day,
      notifyDesktop: settings.notify_desktop,
      notifyEmail: settings.notify_email,
    });
  }, [settings]);

  const updateFn = useServerFn(updateAutomationSettings);
  const updateMutation = useMutation({
    mutationFn: updateFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automation-settings", user?.id] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({ data: form });
  };

  return (
    <main className="paper-grain min-h-screen px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-8">
        <Button asChild variant="ghost" className="text-muted-foreground hover:text-foreground">
          <Link to="/">← Voltar ao diário</Link>
        </Button>
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-semibold text-foreground">Configurações</h1>
          <p className="text-muted-foreground">
            Controle quando e como o app busca suas alterações do dia.
          </p>
        </div>

        {saved && (
          <Alert className="border-border bg-card">
            <AlertTitle className="text-foreground">Salvo</AlertTitle>
            <AlertDescription className="text-muted-foreground">
              As configurações foram atualizadas.
            </AlertDescription>
          </Alert>
        )}

        <Card className="border-border bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="font-display text-xl text-foreground">
              Coleta automática
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Uma vez por dia o app consulta seus commits mais recentes do GitHub e gera um
              rascunho. A publicação no LinkedIn só acontece depois da sua revisão e confirmação.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground">Carregando…</p>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="enabled">Ativada</Label>
                    <p className="text-sm text-muted-foreground">
                      Pausa e retoma a coleta automática.
                    </p>
                  </div>
                  <Switch
                    id="enabled"
                    checked={form.enabled}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="dailyTime">Horário da coleta</Label>
                    <Input
                      id="dailyTime"
                      type="time"
                      value={form.dailyTime}
                      onChange={(e) => setForm((f) => ({ ...f, dailyTime: e.target.value }))}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="timezone">Fuso horário</Label>
                    <Select
                      value={form.timezone}
                      onValueChange={(v) => setForm((f) => ({ ...f, timezone: v }))}
                    >
                      <SelectTrigger id="timezone" className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEZONES.map((tz) => (
                          <SelectItem key={tz} value={tz}>
                            {tz.replace("_", " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultTone">Tom padrão do rascunho</Label>
                  <Select
                    value={form.defaultTone}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, defaultTone: v as TomAutomacao }))
                    }
                  >
                    <SelectTrigger id="defaultTone" className="bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="profissional">Profissional</SelectItem>
                      <SelectItem value="narrativo">Narrativo</SelectItem>
                      <SelectItem value="tecnico">Técnico</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maxCommits">Limite de commits por dia</Label>
                  <Input
                    id="maxCommits"
                    type="number"
                    min={1}
                    max={100}
                    value={form.maxCommitsPerDay}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, maxCommitsPerDay: Number(e.target.value) }))
                    }
                    className="bg-background"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="notifyDesktop">Lembrete na área de notificações</Label>
                    <p className="text-sm text-muted-foreground">
                      Aviso no desktop quando um rascunho ficar pronto.
                    </p>
                  </div>
                  <Switch
                    id="notifyDesktop"
                    checked={form.notifyDesktop}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, notifyDesktop: v }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="notifyEmail">Lembrete por e-mail</Label>
                    <p className="text-sm text-muted-foreground">
                      Envia um aviso quando o rascunho ficar pronto.
                    </p>
                  </div>
                  <Switch
                    id="notifyEmail"
                    checked={form.notifyEmail}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, notifyEmail: v }))}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={updateMutation.isPending}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {updateMutation.isPending ? "Salvando…" : "Salvar configurações"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
