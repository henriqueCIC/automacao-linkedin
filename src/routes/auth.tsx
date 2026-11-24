import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Diário para LinkedIn" },
      {
        name: "description",
        content:
          "Acesse sua conta para registrar as mudanças do dia e revisar rascunhos de posts para o LinkedIn.",
      },
      { property: "og:title", content: "Entrar — Diário para LinkedIn" },
      {
        property: "og:description",
        content: "Acesse sua conta para registrar o dia e revisar seus rascunhos de posts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"entrar" | "criar">("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) void navigate({ to: "/" });
  }, [loading, session, navigate]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "criar") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: name },
          },
        });
        if (error) throw error;
        toast.success("Conta criada! Confirme o e-mail se necessário e faça login.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível continuar.");
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível entrar com o Google.");
      setBusy(false);
    }
  }

  async function onGitHub() {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível entrar com o GitHub.");
      setBusy(false);
    }
  }

  return (
    <main className="paper-grain flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="font-display block text-center text-3xl text-primary">
          Diário → LinkedIn
        </Link>
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="font-display text-2xl">
              {mode === "entrar" ? "Entrar" : "Criar conta"}
            </CardTitle>
            <CardDescription>
              Seus registros e rascunhos ficam salvos com segurança na sua conta.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="w-full" onClick={onGoogle} disabled={busy}>
                Google
              </Button>
              <Button variant="outline" className="w-full" onClick={onGitHub} disabled={busy}>
                GitHub
              </Button>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" /> ou com e-mail{" "}
              <span className="h-px flex-1 bg-border" />
            </div>
            <form onSubmit={onSubmit} className="space-y-4">
              {mode === "criar" && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Seu nome</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Carregando…" : mode === "entrar" ? "Entrar" : "Criar conta"}
              </Button>
            </form>
            <div className="text-center text-sm">
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => setMode(mode === "entrar" ? "criar" : "entrar")}
              >
                {mode === "entrar"
                  ? "Não tem uma conta? Crie agora"
                  : "Já tem uma conta? Faça login"}
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
