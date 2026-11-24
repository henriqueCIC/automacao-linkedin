/**
 * @file collect.server.ts
 * @description Módulo de Ingestão de Commits e Geração de Rascunhos do GitHub.
 * Este arquivo executa exclusivamente no lado do servidor (Server-Only) e é responsável por:
 * 1. Obter credenciais seguras do GitHub do usuário (descriptografadas em memória).
 * 2. Buscar repositórios ativos e varrer commits novos dentro da janela de tempo.
 * 3. Aplicar filtro anti-ruído para descartar lockfiles, dependências e assets pesados.
 * 4. Desduplicar commits usando a tabela 'seen_commits' do PostgreSQL.
 * 5. Sintetizar os diffs através do motor de IA e salvar o rascunho em 'post_drafts'.
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
import { COLLECTION_STEPS } from "./collection-progress";
import { REGRAS_FILTRO_ANTI_RUIDO, deveIncluirArquivo } from "./commit-file-filter";
import { executarComBackoff, registrarEventoOperacional } from "./observability.server";
import { construirPromptColetaCommits } from "./prompts";
import { sanitizarSegredosEmTexto } from "./secret-sanitizer";
import { calcularJanela24HorasAtras, partesDataHoraNoFuso } from "./timezone";
import type { RepositorioGitHub, CommitBrutoGitHub, OrigemGatilhoColeta } from "./types";

export { REGRAS_FILTRO_ANTI_RUIDO, deveIncluirArquivo };

/** Tipo utilitário do cliente Supabase tipado */
type SupabaseAuth = SupabaseClient<Database>;

const MAX_PAGINAS_REPOS = 3;
const MAX_PAGINAS_COMMITS_POR_REPO = 3;
const JANELA_BLOQUEIO_CONCORRENCIA_MS = 10 * 60 * 1000;
const STATUS_COLETA_ATIVA = COLLECTION_STEPS.map((etapa) => etapa.status);

/**
 * Executa chamadas autenticadas à API oficial do GitHub (api.github.com).
 * Utiliza o token de acesso do usuário descriptografado do cofre de credenciais.
 *
 * @param idUsuario - UUID do usuário proprietário da conexão.
 * @param caminhoOuUrl - Endpoint da API (ex: '/user/repos') ou URL completa.
 * @param init - Opções de requisição HTTP complementares.
 * @returns Resposta HTTP da API do GitHub.
 * @throws Erro se o GitHub não estiver conectado ou se o token estiver expirado (401).
 */
async function chamarApiGitHub(
  idUsuario: string,
  caminhoOuUrl: string,
  init?: RequestInit,
): Promise<Response> {
  const conexao = await getConnectionForUser(idUsuario, GITHUB_CONNECTOR_ID);
  if (!conexao) {
    const erro = new Error("GitHub não conectado. Vá em Fontes para autorizar.");
    (erro as Error & { code: string }).code = "GITHUB_NOT_CONNECTED";
    throw erro;
  }

  const cabecalhos = new Headers(init?.headers);
  cabecalhos.set("Authorization", `Bearer ${conexao.connectionAPIKey}`);
  cabecalhos.set("Accept", "application/vnd.github.v3+json");
  cabecalhos.set("User-Agent", "Automacao-LinkedIn-App");

  const urlFinal = caminhoOuUrl.startsWith("http")
    ? caminhoOuUrl
    : `https://api.github.com${caminhoOuUrl}`;

  const metodo = (init?.method ?? "GET").toUpperCase();
  const ehIdempotente = metodo === "GET" || metodo === "HEAD";

  const { resultado: resposta } = await executarComBackoff(
    async () => {
      const res = await fetch(urlFinal, {
        ...init,
        headers: cabecalhos,
      });
      if (ehIdempotente && (res.status === 502 || res.status === 503 || res.status === 504)) {
        const erroTransitorio = new Error(`GitHub temporariamente indisponível (${res.status}).`);
        (erroTransitorio as Error & { transitorio: boolean }).transitorio = true;
        throw erroTransitorio;
      }
      return res;
    },
    {
      maxTentativas: ehIdempotente ? 2 : 1,
      atrasoBaseMs: 25,
      deveRepetir: (erro) =>
        ehIdempotente &&
        (erro instanceof TypeError ||
          Boolean((erro as { transitorio?: boolean } | null)?.transitorio)),
    },
  );

  // Tratamento de token revogado ou expirado no GitHub
  if (resposta.status === 401) {
    await markReconnectRequired(idUsuario, GITHUB_CONNECTOR_ID);
    const erro = new Error("A autorização do GitHub expirou ou é inválida. Reconecte em Fontes.");
    (erro as Error & { code: string }).code = "GITHUB_RECONNECT";
    throw erro;
  }

  return resposta;
}

/**
 * Obtém o login (username) oficial da conta autenticada do GitHub.
 * @param idUsuario - UUID do usuário.
 * @returns Username no GitHub (ex: 'henriqueCIC').
 */
async function buscarLoginUsuario(idUsuario: string): Promise<string> {
  const resposta = await chamarApiGitHub(idUsuario, "/user");
  if (!resposta.ok) {
    throw new Error(
      "Não foi possível verificar sua conta no GitHub. O serviço está indisponível no momento; tente novamente em instantes.",
    );
  }
  const dados = (await resposta.json()) as { login?: string };
  if (!dados.login) {
    throw new Error("Não foi possível identificar o usuário do GitHub.");
  }
  return dados.login;
}

/**
 * Consulta paginada dos repositórios aos quais o usuário tem acesso, ordenados pelos mais recentes (D02).
 * Interrompe a paginação antecipadamente quando os repositórios restantes são anteriores a `dataInicialIso`.
 */
async function buscarRepositoriosUsuario(
  idUsuario: string,
  dataInicialIso?: string,
): Promise<RepositorioGitHub[]> {
  const acumulado: RepositorioGitHub[] = [];
  const limiteDataMs = dataInicialIso ? Date.parse(dataInicialIso) : Number.NaN;

  for (let pagina = 1; pagina <= MAX_PAGINAS_REPOS; pagina += 1) {
    const resposta = await chamarApiGitHub(
      idUsuario,
      `/user/repos?sort=pushed&direction=desc&per_page=100&page=${pagina}`,
    );
    if (!resposta.ok) {
      throw new Error(
        "Não foi possível consultar os repositórios no GitHub. Tente novamente em instantes.",
      );
    }

    const listaBruta = (await resposta.json()) as Array<{
      full_name: string;
      name: string;
      owner?: { login?: string };
      pushed_at?: string | null;
      private?: boolean;
    }>;

    if (listaBruta.length === 0) break;

    let encontrouAnteriorAoMarco = false;
    for (const repo of listaBruta) {
      const [donoPadrao, nomePadrao] = repo.full_name.split("/");
      const ultimoPushEm = repo.pushed_at ?? null;

      if (
        ultimoPushEm &&
        Number.isFinite(limiteDataMs) &&
        Date.parse(ultimoPushEm) < limiteDataMs
      ) {
        encontrouAnteriorAoMarco = true;
        continue;
      }

      acumulado.push({
        nomeCompleto: repo.full_name,
        dono: repo.owner?.login ?? donoPadrao ?? "",
        nome: repo.name ?? nomePadrao ?? "",
        ultimoPushEm,
        privado: repo.private ?? false,
      });
    }

    if (listaBruta.length < 100 || encontrouAnteriorAoMarco) break;
  }

  return acumulado;
}

/**
 * Busca commits realizados pelo usuário em um repositório com paginação de segurança (D02).
 */
async function buscarCommitsDoAutor(
  idUsuario: string,
  dono: string,
  nomeRepo: string,
  login: string,
  dataInicialIso?: string,
): Promise<CommitBrutoGitHub[]> {
  const acumulado: CommitBrutoGitHub[] = [];

  for (let pagina = 1; pagina <= MAX_PAGINAS_COMMITS_POR_REPO; pagina += 1) {
    const parametros = new URLSearchParams({
      author: login,
      per_page: "100",
      page: String(pagina),
    });
    if (dataInicialIso) {
      parametros.set("since", dataInicialIso);
    }

    const resposta = await chamarApiGitHub(
      idUsuario,
      `/repos/${dono}/${nomeRepo}/commits?${parametros.toString()}`,
    );

    // Repositório vazio ou sem histórico
    if (resposta.status === 404 || resposta.status === 409) {
      return [];
    }
    if (!resposta.ok) {
      throw new Error(
        `Não foi possível buscar os commits de ${dono}/${nomeRepo}. Verifique a autorização em Fontes ou tente novamente.`,
      );
    }

    const payload = (await resposta.json()) as Array<{
      sha: string;
      html_url: string;
      commit: {
        message: string;
        author?: {
          name?: string;
          email?: string;
          date?: string;
        };
      };
    }>;

    for (const item of payload) {
      acumulado.push({
        sha: item.sha,
        urlHtml: item.html_url,
        dados: {
          mensagem: item.commit.message,
          ...(item.commit.author
            ? {
                autor: {
                  nome: item.commit.author.name,
                  email: item.commit.author.email,
                  data: item.commit.author.date,
                },
              }
            : {}),
        },
      });
    }

    if (payload.length < 100) break;
  }

  return acumulado;
}

/**
 * Consulta os detalhes completos de um commit individual, incluindo lista de arquivos e diff (patch).
 *
 * @param idUsuario - UUID do usuário.
 * @param dono - Dono do repositório.
 * @param nomeRepo - Nome do repositório.
 * @param sha - Hash identificador do commit.
 */
async function buscarDetalhesCommit(
  idUsuario: string,
  dono: string,
  nomeRepo: string,
  sha: string,
) {
  const resposta = await chamarApiGitHub(idUsuario, `/repos/${dono}/${nomeRepo}/commits/${sha}`);
  if (!resposta.ok) {
    throw new Error("Não foi possível ler o git diff no GitHub. Tente novamente em instantes.");
  }
  return (await resposta.json()) as {
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

/**
 * Trunca patches excessivamente longos para manter o consumo de tokens sob controle.
 * @param patch - Texto do git diff.
 * @param limiteLinhas - Máximo de linhas permitidas por arquivo (padrão: 80 linhas).
 */
function truncarPatch(patch: string, limiteLinhas = 80): string {
  const linhas = patch.split("\n");
  if (linhas.length <= limiteLinhas) return patch;
  return linhas.slice(0, limiteLinhas).join("\n") + "\n... (diff truncado para economia de tokens)";
}

/**
 * Monta o bloco textual com metadados e diffs relevantes de um commit para alimentar a IA.
 *
 * @param detalhe - Detalhes retornados pela API do GitHub para o commit.
 * @param nomeRepo - Nome do repositório.
 */
function montarTextoCommit(
  detalhe: Awaited<ReturnType<typeof buscarDetalhesCommit>>,
  nomeRepo: string,
): string {
  const arquivosRelevantes = (detalhe.files ?? [])
    .filter((arquivo) => deveIncluirArquivo(arquivo.filename))
    .map((arquivo) => {
      const patchSanitizado = arquivo.patch
        ? `\n${truncarPatch(sanitizarSegredosEmTexto(arquivo.patch).textoSanitizado)}`
        : "";
      return `- ${arquivo.filename} (${arquivo.status}, +${arquivo.additions}/-${arquivo.deletions})${patchSanitizado}`;
    })
    .join("\n");

  const mensagemSanitizada = sanitizarSegredosEmTexto(
    detalhe.commit.message.trim(),
  ).textoSanitizado;

  return [
    `Repositório: ${nomeRepo}`,
    `Commit: ${mensagemSanitizada}`,
    `Data: ${detalhe.commit.author?.date ?? ""}`,
    `Link: ${detalhe.html_url}`,
    "Arquivos alterados:",
    arquivosRelevantes || "(nenhum arquivo de código elegível incluído)",
  ].join("\n");
}

/**
 * Carrega a lista de commits já processados anteriormente para o repositório.
 * Garante que a ingestão seja idempotente e nunca processe o mesmo commit duas vezes.
 */
async function carregarHashesProcessados(
  supabase: SupabaseAuth,
  idUsuario: string,
  nomeCompletoRepo: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("seen_commits")
    .select("commit_sha")
    .eq("user_id", idUsuario)
    .eq("repo_full_name", nomeCompletoRepo);

  if (error) throw error;
  return new Set((data ?? []).map((registro) => registro.commit_sha));
}

/**
 * Registra em lote os commits processados SOMENTE após a confirmação de day_entries e post_drafts (D01).
 */
async function registrarCommitsProcessadosEmLote(
  supabase: SupabaseAuth,
  idUsuario: string,
  commits: ReadonlyArray<{ repo: string; sha: string; date?: string | undefined }>,
): Promise<void> {
  if (commits.length === 0) return;

  const registros = commits.map((commit) => ({
    user_id: idUsuario,
    repo_full_name: commit.repo,
    commit_sha: commit.sha,
    committed_at: commit.date ? new Date(commit.date).toISOString() : null,
  }));

  const { error } = await supabase
    .from("seen_commits")
    .upsert(registros, { onConflict: "user_id,repo_full_name,commit_sha" });

  if (error) {
    throw new Error("Não foi possível confirmar a marcação dos commits processados.");
  }
}

/**
 * Verifica se já existe outra coleta ativa recente para o mesmo usuário, evitando execuções sobrepostas.
 */
async function existeColetaAtivaEmAndamento(
  supabase: SupabaseAuth,
  idUsuario: string,
  runIdAtual: string,
): Promise<boolean> {
  const limiteRecenteIso = new Date(Date.now() - JANELA_BLOQUEIO_CONCORRENCIA_MS).toISOString();
  const { data, error } = await supabase
    .from("collection_runs")
    .select("id")
    .eq("user_id", idUsuario)
    .neq("id", runIdAtual)
    .in("status", [...STATUS_COLETA_ATIVA])
    .gte("created_at", limiteRecenteIso)
    .limit(1)
    .maybeSingle();

  if (error) return false;
  return Boolean(data?.id);
}

/**
 * Carrega as preferências de automação do usuário ou cria o registro padrão caso ainda não exista.
 */
async function obterOuCriarConfiguracoesAutomacao(supabase: SupabaseAuth, idUsuario: string) {
  const { data, error } = await supabase
    .from("automation_settings")
    .select("*")
    .eq("user_id", idUsuario)
    .single();

  if (error?.code === "PGRST116" || !data) {
    const configuracaoPadrao = {
      user_id: idUsuario,
      enabled: true,
      daily_time: "18:00",
      timezone: "America/Bahia",
      default_tone: "profissional",
      max_commits_per_day: 15,
      notify_desktop: true,
      notify_email: false,
    };

    const { data: criado, error: erroInsercao } = await supabase
      .from("automation_settings")
      .insert(configuracaoPadrao)
      .select()
      .single();

    if (erroInsercao) throw erroInsercao;
    return criado;
  }

  if (error) throw error;
  return data;
}

/**
 * Consulta o timestamp de término da última rodada de coleta executada com sucesso.
 */
async function buscarDataUltimaColetaComSucesso(
  supabase: SupabaseAuth,
  idUsuario: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("collection_runs")
    .select("until_at")
    .eq("user_id", idUsuario)
    .eq("status", "ok")
    .order("until_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return data.until_at;
}

/**
 * Calcula a data inicial padrão de busca caso seja a primeira execução do usuário (últimas 24 horas UTC).
 */
function calcularDataInicialPadrao(): string {
  return calcularJanela24HorasAtras();
}

/**
 * Função principal do fluxo de ingestão:
 * Executa a coleta completa de commits do GitHub, filtra ruídos, sintetiza via IA e gera o rascunho de post.
 *
 * @param supabaseAdmin - Cliente do Supabase com privilégios de execução.
 * @param idUsuario - UUID do usuário proprietário dos dados.
 * @param gatilho - Origem do disparo ('manual' ou 'cron').
 * @param idExecucaoSolicitado - ID opcional para rastreamento prévio do ciclo.
 */
export async function collectForUser(
  supabaseAdmin: SupabaseAuth,
  idUsuario: string,
  gatilho: OrigemGatilhoColeta,
  idExecucaoSolicitado?: string,
): Promise<{
  runId: string;
  status: string;
  commitsFound: number;
  repositories: string[];
  dayEntryId?: string;
  postDraftId?: string;
  message?: string;
}> {
  const inicioMs = Date.now();
  const inicioExecucao = new Date(inicioMs).toISOString();
  const runId = idExecucaoSolicitado ?? crypto.randomUUID();

  // 0. Impede coletas concorrentes sobrepostas para o mesmo usuário
  if (await existeColetaAtivaEmAndamento(supabaseAdmin, idUsuario, runId)) {
    registrarEventoOperacional({
      evento: "coleta_ignorada",
      runId,
      userId: idUsuario,
      gatilho,
      status: "ignorado",
      mensagem: "Coleta concorrente bloqueada.",
    });
    return {
      runId,
      status: "ignorado",
      commitsFound: 0,
      repositories: [],
      message: "Já existe uma coleta em andamento para sua conta. Aguarde a conclusão.",
    };
  }

  registrarEventoOperacional({
    evento: "coleta_iniciada",
    runId,
    userId: idUsuario,
    gatilho,
    status: "autenticando",
  });

  // 1. Registra o início do ciclo de coleta no banco
  const { error: erroInicio } = await supabaseAdmin.from("collection_runs").insert({
    id: runId,
    user_id: idUsuario,
    trigger: gatilho,
    until_at: inicioExecucao,
    status: "autenticando",
    message: "Verificando o login e a autorização da conta GitHub…",
  });
  if (erroInicio) {
    throw new Error("Não foi possível iniciar o acompanhamento da coleta.");
  }

  /** Atualiza o progresso em tempo real na tabela 'collection_runs' */
  async function atualizarProgresso(
    status: string,
    message: string,
    commits = 0,
    repositorios: string[] = [],
  ) {
    const { error } = await supabaseAdmin
      .from("collection_runs")
      .update({
        status,
        message,
        commits_found: commits,
        repositories: repositorios,
      })
      .eq("id", runId)
      .eq("user_id", idUsuario);

    if (error) {
      throw new Error("Não foi possível atualizar o acompanhamento da coleta.");
    }
  }

  try {
    // 2. Valida configurações e horário de automação
    const configuracoes = await obterOuCriarConfiguracoesAutomacao(supabaseAdmin, idUsuario);
    if (!configuracoes.enabled && gatilho === "cron") {
      await atualizarProgresso("skipped", "Automação desativada nas configurações do usuário.");
      return {
        runId,
        status: "skipped",
        commitsFound: 0,
        repositories: [],
        message: "Automação desativada nas configurações.",
      };
    }

    // 3. Define a janela de tempo da busca (desde a última coleta com sucesso)
    const desdeQuando =
      (await buscarDataUltimaColetaComSucesso(supabaseAdmin, idUsuario)) ??
      calcularDataInicialPadrao();

    const { error: erroSince } = await supabaseAdmin
      .from("collection_runs")
      .update({ since_at: desdeQuando })
      .eq("id", runId)
      .eq("user_id", idUsuario);
    if (erroSince) {
      throw new Error("Não foi possível atualizar o acompanhamento da coleta.");
    }

    // 4. Confirma o login da conta do GitHub
    let loginUsuario: string;
    try {
      loginUsuario = await buscarLoginUsuario(idUsuario);
      await saveAccountLogin(idUsuario, GITHUB_CONNECTOR_ID, loginUsuario);
    } catch (erro) {
      const mensagem =
        erro instanceof Error ? erro.message : "Falha ao identificar conta do GitHub.";
      const { error: erroFinal } = await supabaseAdmin
        .from("collection_runs")
        .update({
          user_id: idUsuario,
          trigger: gatilho,
          since_at: desdeQuando,
          until_at: inicioExecucao,
          commits_found: 0,
          repositories: [],
          status: "erro",
          message: mensagem,
        })
        .eq("id", runId)
        .eq("user_id", idUsuario);

      if (erroFinal) {
        throw new Error("Não foi possível salvar o resultado da coleta.");
      }

      return {
        runId,
        status: "erro",
        commitsFound: 0,
        repositories: [],
        message: mensagem,
      };
    }

    // 5. Busca repositórios ativos do usuário com paginação e filtro temporal (D02)
    await atualizarProgresso(
      "repositorios",
      `Conta conectada (@${loginUsuario}). Localizando repositórios ativos…`,
    );
    const repositorios = await buscarRepositoriosUsuario(idUsuario, desdeQuando);

    await atualizarProgresso(
      "commits",
      `${repositorios.length} repositório(s) elegível(is). Varrendo commits recentes…`,
    );

    const limiteMaximoCommits = configuracoes.max_commits_per_day ?? 15;
    const todosCommitsNaoVistos: Array<{
      repo: string;
      sha: string;
      message: string;
      date?: string;
      url: string;
    }> = [];

    for (const repo of repositorios.slice(0, 100)) {
      await atualizarProgresso(
        "commits",
        `Repositório: ${repo.nomeCompleto}. Buscando novos commits…`,
        todosCommitsNaoVistos.length,
        [...new Set(todosCommitsNaoVistos.map((c) => c.repo))],
      );

      const commitsJaVistos = await carregarHashesProcessados(
        supabaseAdmin,
        idUsuario,
        repo.nomeCompleto,
      );

      try {
        const commitsEncontrados = await buscarCommitsDoAutor(
          idUsuario,
          repo.dono,
          repo.nome,
          loginUsuario,
          desdeQuando,
        );

        for (const commit of commitsEncontrados) {
          if (commitsJaVistos.has(commit.sha)) continue;

          todosCommitsNaoVistos.push({
            repo: repo.nomeCompleto,
            sha: commit.sha,
            message: commit.dados.mensagem,
            url: commit.urlHtml,
            ...(commit.dados.autor?.data ? { date: commit.dados.autor.data } : {}),
          });
        }
      } catch (erro) {
        console.error(`Erro ao consultar commits de ${repo.nomeCompleto}:`, erro);
        throw erro;
      }
    }

    // Ordena cronologicamente do mais antigo ao mais recente para preservar fila determinística (D02)
    todosCommitsNaoVistos.sort((a, b) => {
      const ta = a.date ? Date.parse(a.date) : 0;
      const tb = b.date ? Date.parse(b.date) : 0;
      return ta - tb;
    });

    const commitsParaProcessar = todosCommitsNaoVistos.slice(0, limiteMaximoCommits);
    const commitsPendentes = Math.max(
      0,
      todosCommitsNaoVistos.length - commitsParaProcessar.length,
    );

    // 6. Caso nenhum commit novo tenha sido feito na janela de tempo
    if (commitsParaProcessar.length === 0) {
      const { error: erroFinal } = await supabaseAdmin
        .from("collection_runs")
        .update({
          user_id: idUsuario,
          trigger: gatilho,
          since_at: desdeQuando,
          until_at: inicioExecucao,
          commits_found: 0,
          repositories: [],
          status: "ok",
          message: "Nenhum commit novo encontrado desde a última coleta.",
        })
        .eq("id", runId)
        .eq("user_id", idUsuario);

      if (erroFinal) {
        throw new Error("Não foi possível salvar o resultado da coleta.");
      }

      return {
        runId,
        status: "ok",
        commitsFound: 0,
        repositories: [],
        message: "Nenhum commit novo encontrado desde a última coleta.",
      };
    }

    // 7. Obtenção detalhada dos diffs com sanitização de ruídos e segredos (sem marcar seen_commits antes da persistência - D01)
    const blocosDiffsTexto: string[] = [];
    const repositoriosComCommits = new Set<string>();
    const commitsConfirmadosParaMarcar: Array<{ repo: string; sha: string; date?: string }> = [];

    for (const [indice, commit] of commitsParaProcessar.entries()) {
      await atualizarProgresso(
        "diffs",
        `Lendo diffs: ${indice + 1}/${commitsParaProcessar.length} · ${commit.repo} (${commit.sha.slice(0, 7)})`,
        blocosDiffsTexto.length,
        [...repositoriosComCommits],
      );

      const [dono, nome] = commit.repo.split("/");
      if (!dono || !nome) continue;

      try {
        const detalhes = await buscarDetalhesCommit(idUsuario, dono, nome, commit.sha);
        blocosDiffsTexto.push(montarTextoCommit(detalhes, commit.repo));
        repositoriosComCommits.add(commit.repo);
        commitsConfirmadosParaMarcar.push(commit);
      } catch (erro) {
        console.error(`Erro ao ler detalhes do commit ${commit.sha}:`, erro);
        throw erro;
      }
    }

    if (blocosDiffsTexto.length === 0) {
      throw new Error("Não foi possível ler os diffs dos commits encontrados. Tente novamente.");
    }

    // 8. Síntese Semântica com Inteligência Artificial (aplicando o tom configurado)
    await atualizarProgresso(
      "gerando",
      `${blocosDiffsTexto.length} diff(s) processado(s). Gerando resumo e rascunho com IA…`,
      blocosDiffsTexto.length,
      [...repositoriosComCommits],
    );

    const promptColeta = construirPromptColetaCommits({
      loginUsuario,
      desdeQuando,
      ateQuando: inicioExecucao,
      blocosCommits: blocosDiffsTexto,
      tom: configuracoes.default_tone,
    });

    let sinteseIA: { summary: string; content: string };
    try {
      sinteseIA = await callAi(promptColeta.system, promptColeta.user);
    } catch (erro) {
      const mensagemErro =
        erro instanceof Error ? erro.message : "Falha ao processar resumo com IA.";

      const { error: erroFinal } = await supabaseAdmin
        .from("collection_runs")
        .update({
          user_id: idUsuario,
          trigger: gatilho,
          since_at: desdeQuando,
          until_at: inicioExecucao,
          commits_found: blocosDiffsTexto.length,
          repositories: Array.from(repositoriosComCommits),
          status: "erro",
          message: mensagemErro,
        })
        .eq("id", runId)
        .eq("user_id", idUsuario);

      if (erroFinal) {
        throw new Error("Não foi possível salvar o resultado da coleta.");
      }

      return {
        runId,
        status: "erro",
        commitsFound: blocosDiffsTexto.length,
        repositories: Array.from(repositoriosComCommits),
        message: mensagemErro,
      };
    }

    // 9. Persistência do Registro Diário ('day_entries') e Rascunho ('post_drafts')
    await atualizarProgresso(
      "salvando",
      "Síntese concluída! Salvando o rascunho de post para sua revisão…",
      blocosDiffsTexto.length,
      [...repositoriosComCommits],
    );

    const dataHoje = partesDataHoraNoFuso(configuracoes.timezone).data;

    const { data: entradaDiaria, error: erroEntrada } = await supabaseAdmin
      .from("day_entries")
      .insert({
        user_id: idUsuario,
        entry_date: dataHoje,
        raw_notes: sinteseIA.summary,
        source: "github",
      })
      .select("id")
      .single();

    if (erroEntrada) throw erroEntrada;

    const { data: rascunho, error: erroRascunho } = await supabaseAdmin
      .from("post_drafts")
      .insert({
        user_id: idUsuario,
        day_entry_id: entradaDiaria.id,
        summary: sinteseIA.summary,
        content: sinteseIA.content,
        tone: promptColeta.tomAplicado,
        status: "rascunho",
      })
      .select("id")
      .single();

    if (erroRascunho) throw erroRascunho;

    // 10. Confirma os commits como vistos SOMENTE após salvar day_entries e post_drafts (D01)
    await registrarCommitsProcessadosEmLote(supabaseAdmin, idUsuario, commitsConfirmadosParaMarcar);

    // 11. Finaliza a rodada preservando a marca d'água 'desdeQuando' se ainda restarem excedentes (D02)
    const untilAtSeguro = commitsPendentes > 0 ? desdeQuando : inicioExecucao;
    const mensagemSucesso =
      commitsPendentes > 0
        ? `Rascunho gerado com sucesso a partir de ${blocosDiffsTexto.length} commit(s) (${commitsPendentes} restante(s) para a próxima coleta).`
        : `Rascunho gerado com sucesso a partir de ${blocosDiffsTexto.length} commit(s).`;

    const { error: erroFinal } = await supabaseAdmin
      .from("collection_runs")
      .update({
        user_id: idUsuario,
        trigger: gatilho,
        since_at: desdeQuando,
        until_at: untilAtSeguro,
        commits_found: blocosDiffsTexto.length,
        repositories: Array.from(repositoriosComCommits),
        day_entry_id: entradaDiaria.id,
        post_draft_id: rascunho.id,
        status: "ok",
        message: mensagemSucesso,
      })
      .eq("id", runId)
      .eq("user_id", idUsuario);

    if (erroFinal) {
      throw new Error("Não foi possível salvar o resultado da coleta.");
    }

    registrarEventoOperacional({
      evento: "coleta_concluida",
      runId,
      userId: idUsuario,
      gatilho,
      status: "ok",
      duracaoMs: Date.now() - inicioMs,
      commitsEncontrados: blocosDiffsTexto.length,
      repositoriosCount: repositoriosComCommits.size,
      commitsPendentes,
      mensagem: mensagemSucesso,
    });

    return {
      runId,
      status: "ok",
      commitsFound: blocosDiffsTexto.length,
      repositories: Array.from(repositoriosComCommits),
      dayEntryId: entradaDiaria.id,
      postDraftId: rascunho.id,
      message: mensagemSucesso,
    };
  } catch (erro) {
    const mensagemErroGeral =
      erro instanceof Error ? erro.message : "Não foi possível concluir o ciclo de coleta.";

    registrarEventoOperacional({
      evento: "coleta_falhou",
      runId,
      userId: idUsuario,
      gatilho,
      status: "erro",
      duracaoMs: Date.now() - inicioMs,
      mensagem: mensagemErroGeral,
    });

    const { error: erroRegistroCatch } = await supabaseAdmin
      .from("collection_runs")
      .update({ status: "erro", message: mensagemErroGeral })
      .eq("id", runId)
      .eq("user_id", idUsuario);

    if (erroRegistroCatch) {
      console.error("Falha ao registrar erro final na tabela collection_runs:", erroRegistroCatch);
    }

    return {
      runId,
      status: "erro",
      commitsFound: 0,
      repositories: [],
      message: mensagemErroGeral,
    };
  }
}
