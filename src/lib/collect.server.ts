/**
 * GitHub commit collection and draft generation core.
 * Server-only — called by authenticated server functions and the cron route.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  GITHUB_CONNECTOR_ID,
  getConnectionForUser,
  markReconnectRequired,
  saveAccountLogin,
} from "./appUserConnections.server";
import { callAi } from "./ai.server";

type SupabaseAuth = SupabaseClient<Database>;

const IGNORED_PATHS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /bun\.lockb$/,
  /composer\.lock$/,
  /Gemfile\.lock$/,
  /\.lock$/,
  /dist\//,
  /build\//,
  /\.next\//,
  /node_modules\//,
  /\.git\//,
  /coverage\//,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.svg$/,
  /\.ico$/,
  /\.woff2?$/,
  /\.ttf$/,
  /\.otf$/,
  /\.eot$/,
  /\.mp4$/,
  /\.mp3$/,
  /\.pdf$/,
  /\.zip$/,
  /\.tar\.gz$/,
];

function shouldIncludeFile(filename: string): boolean {
  return !IGNORED_PATHS.some((pattern) => pattern.test(filename));
}

async function githubFetch(userId: string, path: string, init?: RequestInit) {
  const connection = await getConnectionForUser(userId, GITHUB_CONNECTOR_ID);
  if (!connection) {
    const err = new Error("GitHub não conectado. Vá em Fontes para autorizar.");
    (err as Error & { code: string }).code = "GITHUB_NOT_CONNECTED";
    throw err;
  }

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${connection.connectionAPIKey}`);
  headers.set("Accept", "application/vnd.github.v3+json");
  headers.set("User-Agent", "Automacao-LinkedIn-App");

  const url = path.startsWith("http") ? path : `https://api.github.com${path}`;
  const res = await fetch(url, {
    ...init,
    headers,
  });

  if (res.status === 401) {
    await markReconnectRequired(userId, GITHUB_CONNECTOR_ID);
    const err = new Error("A autorização do GitHub expirou ou é inválida. Reconecte em Fontes.");
    (err as Error & { code: string }).code = "GITHUB_RECONNECT";
    throw err;
  }

  return res;
}

async function fetchAccountLogin(userId: string): Promise<string> {
  const res = await githubFetch(userId, "/user");
  if (!res.ok) throw new Error("Não foi possível verificar sua conta no GitHub. O serviço está indisponível no momento; tente novamente em instantes.");
  const user = (await res.json()) as { login?: string };
  if (!user.login) throw new Error("Não foi possível identificar o usuário do GitHub.");
  return user.login;
}

async function fetchRepos(userId: string) {
  const res = await githubFetch(userId, "/user/repos?sort=pushed&per_page=100");
  if (!res.ok) throw new Error("Não foi possível consultar os repositórios no GitHub. Tente novamente em instantes.");
  const repos = (await res.json()) as Array<{
    full_name: string;
    pushed_at?: string | null;
  }>;
  return repos;
}

async function fetchCommits(
  userId: string,
  owner: string,
  repo: string,
  login: string,
  since?: string,
) {
  const params = new URLSearchParams({ author: login, per_page: "100" });
  if (since) params.set("since", since);
  const res = await githubFetch(
    userId,
    `/repos/${owner}/${repo}/commits?${params.toString()}`,
  );
  if (res.status === 404 || res.status === 409) return [];
  if (!res.ok) throw new Error(`Não foi possível buscar os commits de ${owner}/${repo}. Verifique a autorização em Fontes ou tente novamente.`);
  return (await res.json()) as Array<{
    sha: string;
    commit: { message: string; author?: { date?: string } };
    html_url: string;
  }>;
}

async function fetchCommitDetail(userId: string, owner: string, repo: string, sha: string) {
  const res = await githubFetch(userId, `/repos/${owner}/${repo}/commits/${sha}`);
  if (!res.ok) throw new Error("Não foi possível ler o git diff no GitHub. Tente novamente em instantes.");
  return (await res.json()) as {
    sha: string;
    commit: { message: string; author?: { date?: string } };
    html_url: string;
    files?: Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }>;
    stats?: { additions?: number; deletions?: number };
  };
}

function truncatePatch(patch: string, maxLines = 80): string {
  const lines = patch.split("\n");
  if (lines.length <= maxLines) return patch;
  return lines.slice(0, maxLines).join("\n") + "\n... (diff truncado)";
}

function buildCommitText(detail: Awaited<ReturnType<typeof fetchCommitDetail>>, repo: string): string {
  const files = (detail.files ?? [])
    .filter((f) => shouldIncludeFile(f.filename))
    .map((f) => {
      const patch = f.patch ? `\n${truncatePatch(f.patch)}` : "";
      return `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})${patch}`;
    })
    .join("\n");

  return [
    `Repositório: ${repo}`,
    `Commit: ${detail.commit.message.trim()}`,
    `Data: ${detail.commit.author?.date ?? ""}`,
    `Link: ${detail.html_url}`,
    "Arquivos alterados:",
    files || "(nenhum arquivo legível incluído)",
  ].join("\n");
}

async function loadSeenShas(
  supabase: SupabaseAuth,
  userId: string,
  repoFullName: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("seen_commits")
    .select("commit_sha")
    .eq("user_id", userId)
    .eq("repo_full_name", repoFullName);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.commit_sha));
}

async function recordSeenCommit(
  supabase: SupabaseAuth,
  userId: string,
  repoFullName: string,
  sha: string,
  committedAt?: string,
) {
  const { error } = await supabase.from("seen_commits").upsert(
    {
      user_id: userId,
      repo_full_name: repoFullName,
      commit_sha: sha,
      committed_at: committedAt ? new Date(committedAt).toISOString() : null,
    },
    { onConflict: "user_id,repo_full_name,commit_sha" },
  );
  if (error) console.error("Failed to record seen commit:", error);
}

async function getOrCreateAutomationSettings(supabase: SupabaseAuth, userId: string) {
  const { data, error } = await supabase
    .from("automation_settings")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error?.code === "PGRST116" || !data) {
    const insert = {
      user_id: userId,
      enabled: true,
      daily_time: "18:00",
      timezone: "America/Bahia",
      default_tone: "profissional",
      max_commits_per_day: 15,
      notify_desktop: true,
      notify_email: false,
    };
    const { data: created, error: insertError } = await supabase
      .from("automation_settings")
      .insert(insert)
      .select()
      .single();
    if (insertError) throw insertError;
    return created;
  }
  if (error) throw error;
  return data;
}

async function lastSuccessfulRun(supabase: SupabaseAuth, userId: string) {
  const { data, error } = await supabase
    .from("collection_runs")
    .select("until_at")
    .eq("user_id", userId)
    .eq("status", "ok")
    .order("until_at", { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return data.until_at;
}

function defaultSince(timezone = "America/Bahia") {
  // On the very first run, look back 24 hours in the user's timezone.
  const now = new Date();
  const offset =
    timezone === "America/Bahia" ? -3 * 60 : now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  local.setHours(local.getHours() - 24);
  return local.toISOString();
}

const COLLECT_SYSTEM = [
  "Você é um assistente que resume a atividade de desenvolvimento de uma pessoa, em português do Brasil.",
  "Você receberá uma lista de commits com seus diffs.",
  "Escreva um resumo do dia como se a pessoa estivesse registrando o que fez.",
  "Destaque: o que foi implementado, o que foi corrigido e o que ela provavelmente aprendeu com as mudanças.",
  "Não invente fatos que não estejam nos commits. Não exponha segredos, senhas, tokens ou trechos sensíveis de código.",
  "Se os diffs não sustentarem uma conclusão de aprendizado, não force.",
  "Use tópicos claros. O texto deve servir como anotações do dia para um post futuro.",
].join("\n");

export async function collectForUser(
  supabaseAdmin: SupabaseAuth,
  userId: string,
  trigger: "manual" | "cron",
  requestedRunId?: string,
): Promise<{
  runId: string;
  status: string;
  commitsFound: number;
  repositories: string[];
  dayEntryId?: string;
  postDraftId?: string;
  message?: string;
}> {
  const runStart = new Date().toISOString();

  const runId = requestedRunId ?? crypto.randomUUID();
  const { error: startError } = await supabaseAdmin.from("collection_runs").insert({
    id: runId, user_id: userId, trigger, until_at: runStart,
    status: "autenticando", message: "Verificando o login e a autorização da conta GitHub…",
  });
  if (startError) throw new Error("Não foi possível iniciar o acompanhamento da coleta.");

  async function progress(status: string, message: string, commits = 0, repositories: string[] = []) {
    const { error } = await supabaseAdmin.from("collection_runs")
      .update({ status, message, commits_found: commits, repositories })
      .eq("id", runId).eq("user_id", userId);
    if (error) throw new Error("Não foi possível atualizar o acompanhamento da coleta.");
  }

  try {
  const settings = await getOrCreateAutomationSettings(supabaseAdmin, userId);
  if (!settings.enabled && trigger === "cron") {
    await progress("skipped", "Automação desativada nas configurações.");
    return {
      runId,
      status: "skipped",
      commitsFound: 0,
      repositories: [],
      message: "Automação desativada nas configurações.",
    };
  }

  const since = (await lastSuccessfulRun(supabaseAdmin, userId)) ?? defaultSince(settings.timezone);

  await supabaseAdmin.from("collection_runs").update({ since_at: since }).eq("id", runId).eq("user_id", userId);
  let login: string;
  try {
    login = await fetchAccountLogin(userId);
    await saveAccountLogin(userId, GITHUB_CONNECTOR_ID, login);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao buscar usuário do GitHub.";
    const { error: finishError } = await supabaseAdmin
      .from("collection_runs")
      .update({
        user_id: userId,
        trigger,
        since_at: since,
        until_at: runStart,
        commits_found: 0,
        repositories: [],
        status: "erro",
        message,
      })
      .eq("id", runId).eq("user_id", userId);
    if (finishError) throw new Error("Não foi possível salvar o resultado da coleta.");
    return {
      runId,
      status: "erro",
      commitsFound: 0,
      repositories: [],
      message,
    };
  }

  await progress("repositorios", `Login confirmado na conta ${login}. Encontrando repositórios…`);
  const repos = await fetchRepos(userId);
  await progress("commits", `${repos.length} repositório(s) encontrado(s). Buscando commits novos…`);
  const maxCommits = settings.max_commits_per_day ?? 15;
  const commitsToProcess: Array<{
    repo: string;
    sha: string;
    message: string;
    date?: string;
    url: string;
  }> = [];

  for (const repo of repos.slice(0, 50)) {
    const [owner, name] = repo.full_name.split("/");
    if (!owner || !name) continue;
    await progress("commits", `Repositório encontrado: ${repo.full_name}. Buscando commits novos…`, commitsToProcess.length, [...new Set(commitsToProcess.map((c) => c.repo))]);
    const seen = await loadSeenShas(supabaseAdmin, userId, repo.full_name);
    try {
      const commits = await fetchCommits(userId, owner, name, login, since);
      for (const c of commits) {
        if (seen.has(c.sha)) continue;
        commitsToProcess.push({
          repo: repo.full_name,
          sha: c.sha,
          message: c.commit.message,
          url: c.html_url,
          ...(c.commit.author?.date ? { date: c.commit.author.date } : {}),
        });
        if (commitsToProcess.length >= maxCommits) break;
      }
    } catch (error) {
      console.error(`Error fetching commits for ${repo.full_name}:`, error);
      throw error;
    }
    if (commitsToProcess.length >= maxCommits) break;
  }

  if (commitsToProcess.length === 0) {
    const { error: finishError } = await supabaseAdmin
      .from("collection_runs")
      .update({
        user_id: userId,
        trigger,
        since_at: since,
        until_at: runStart,
        commits_found: 0,
        repositories: [],
        status: "ok",
        message: "Nenhum commit novo encontrado desde a última coleta.",
      })
      .eq("id", runId).eq("user_id", userId);
    if (finishError) throw new Error("Não foi possível salvar o resultado da coleta.");
    return {
      runId,
      status: "ok",
      commitsFound: 0,
      repositories: [],
      message: "Nenhum commit novo encontrado.",
    };
  }

  // Fetch detail (with diffs) for each new commit.
  const details: string[] = [];
  const repositories = new Set<string>();
  for (const [index, c] of commitsToProcess.entries()) {
    await progress("diffs", `Lendo git diff do período: ${index + 1}/${commitsToProcess.length} · ${c.repo} · ${c.sha.slice(0, 7)}`, details.length, [...repositories]);
    const [owner, name] = c.repo.split("/");
    if (!owner || !name) continue;
    try {
      const detail = await fetchCommitDetail(userId, owner, name, c.sha);
      details.push(buildCommitText(detail, c.repo));
      repositories.add(c.repo);
      await recordSeenCommit(supabaseAdmin, userId, c.repo, c.sha, c.date);
    } catch (error) {
      console.error(`Error fetching commit detail ${c.sha}:`, error);
      throw error;
    }
  }

  if (details.length === 0) throw new Error("Não foi possível ler os diffs dos commits encontrados. Tente novamente.");
  await progress("gerando", `${details.length} diff(s) lido(s). Compondo o resumo e os possíveis aprendizados…`, details.length, [...repositories]);
  const input = [
    `Usuário: ${login}`,
    `Período: ${since} até ${runStart}`,
    `Total de commits novos: ${details.length}`,
    "",
    ...details,
  ].join("\n\n");

  let summary: { summary: string; content: string };
  try {
    summary = await callAi(COLLECT_SYSTEM, input);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao gerar resumo com IA.";
    const { error: finishError } = await supabaseAdmin
      .from("collection_runs")
      .update({
        user_id: userId,
        trigger,
        since_at: since,
        until_at: runStart,
        commits_found: details.length,
        repositories: Array.from(repositories),
        status: "erro",
        message,
      })
      .eq("id", runId).eq("user_id", userId);
    if (finishError) throw new Error("Não foi possível salvar o resultado da coleta.");
    return {
      runId,
      status: "erro",
      commitsFound: details.length,
      repositories: Array.from(repositories),
      message,
    };
  }

  await progress("salvando", "Resumo gerado. Salvando o rascunho para sua revisão…", details.length, [...repositories]);
  const today = new Date().toISOString().slice(0, 10);
  const { data: entry, error: entryError } = await supabaseAdmin
    .from("day_entries")
    .insert({
      user_id: userId,
      entry_date: today,
      raw_notes: summary.summary,
      source: "github",
    })
    .select("id")
    .single();
  if (entryError) throw entryError;

  const { data: draft, error: draftError } = await supabaseAdmin
    .from("post_drafts")
    .insert({
      user_id: userId,
      day_entry_id: entry.id,
      summary: summary.summary,
      content: summary.content,
      tone: settings.default_tone ?? "profissional",
      status: "rascunho",
    })
    .select("id")
    .single();
  if (draftError) throw draftError;

  const { error: finishError } = await supabaseAdmin
    .from("collection_runs")
    .update({
      user_id: userId,
      trigger,
      since_at: since,
      until_at: runStart,
      commits_found: details.length,
      repositories: Array.from(repositories),
      day_entry_id: entry.id,
      post_draft_id: draft.id,
      status: "ok",
      message: `Rascunho gerado a partir de ${details.length} commit(s).`,
    })
    .eq("id", runId).eq("user_id", userId);
  if (finishError) throw new Error("Não foi possível salvar o resultado da coleta.");

  return {
    runId,
    status: "ok",
    commitsFound: details.length,
    repositories: Array.from(repositories),
    dayEntryId: entry.id,
    postDraftId: draft.id,
    message: `Rascunho gerado a partir de ${details.length} commit(s).`,
  };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível concluir a coleta.";
    await supabaseAdmin.from("collection_runs").update({ status: "erro", message }).eq("id", runId).eq("user_id", userId);
    return { runId, status: "erro", commitsFound: 0, repositories: [], message };
  }
}
