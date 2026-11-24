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
import { REGRAS_FILTRO_ANTI_RUIDO, deveIncluirArquivo } from "./commit-file-filter";
import type { RepositorioGitHub, CommitBrutoGitHub, OrigemGatilhoColeta } from "./types";

export { REGRAS_FILTRO_ANTI_RUIDO, deveIncluirArquivo };

/** Tipo utilitário do cliente Supabase tipado */
type SupabaseAuth = SupabaseClient<Database>;

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

  const resposta = await fetch(urlFinal, {
    ...init,
    headers: cabecalhos,
  });

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
 * Consulta os repositórios aos quais o usuário tem acesso, ordenados pelos mais recentes.
 * @param idUsuario - UUID do usuário.
 * @returns Lista de repositórios com nome e data do último push.
 */
async function buscarRepositoriosUsuario(idUsuario: string): Promise<RepositorioGitHub[]> {
  const resposta = await chamarApiGitHub(idUsuario, "/user/repos?sort=pushed&per_page=100");
  if (!resposta.ok) {
    throw new Error("Não foi possível consultar os repositórios no GitHub. Tente novamente em instantes.");
  }
  const listaBruta = (await resposta.json()) as Array<{
    full_name: string;
    name: string;
    owner?: { login?: string };
    pushed_at?: string | null;
    private?: boolean;
  }>;

  return listaBruta.map((repo) => {
    const [donoPadrao, nomePadrao] = repo.full_name.split("/");
    return {
      nomeCompleto: repo.full_name,
      dono: repo.owner?.login ?? donoPadrao ?? "",
      nome: repo.name ?? nomePadrao ?? "",
      ultimoPushEm: repo.pushed_at ?? null,
      privado: repo.private ?? false,
    };
  });
}

/**
 * Busca commits realizados especificamente pelo usuário em um repositório dentro de uma janela temporal.
 *
 * @param idUsuario - UUID do usuário.
 * @param dono - Proprietário do repositório.
 * @param nomeRepo - Nome do repositório.
 * @param login - Login do GitHub para filtrar commits por autor.
 * @param dataInicialIso - Data ISO a partir da qual os commits serão considerados.
 * @returns Lista de commits brutos encontrados.
 */
async function buscarCommitsDoAutor(
  idUsuario: string,
  dono: string,
  nomeRepo: string,
  login: string,
  dataInicialIso?: string,
): Promise<CommitBrutoGitHub[]> {
  const parametros = new URLSearchParams({ author: login, per_page: "100" });
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

  return payload.map((item) => ({
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
  }));
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
      const trechoPatch = arquivo.patch ? `\n${truncarPatch(arquivo.patch)}` : "";
      return `- ${arquivo.filename} (${arquivo.status}, +${arquivo.additions}/-${arquivo.deletions})${trechoPatch}`;
    })
    .join("\n");

  return [
    `Repositório: ${nomeRepo}`,
    `Commit: ${detalhe.commit.message.trim()}`,
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
 * Registra um commit no banco de dados como processado.
 */
async function registrarCommitProcessado(
  supabase: SupabaseAuth,
  idUsuario: string,
  nomeCompletoRepo: string,
  sha: string,
  dataCommit?: string,
): Promise<void> {
  const { error } = await supabase.from("seen_commits").upsert(
    {
      user_id: idUsuario,
      repo_full_name: nomeCompletoRepo,
      commit_sha: sha,
      committed_at: dataCommit ? new Date(dataCommit).toISOString() : null,
    },
    { onConflict: "user_id,repo_full_name,commit_sha" },
  );

  if (error) {
    console.error("Falha ao registrar commit processado:", error);
  }
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
 * Calcula a data inicial padrão de busca caso seja a primeira execução do usuário (últimas 24 horas).
 */
function calcularDataInicialPadrao(fusoHorario = "America/Bahia"): string {
  const agora = new Date();
  const deslocamento =
    fusoHorario === "America/Bahia" ? -3 * 60 : agora.getTimezoneOffset();
  const horaLocal = new Date(agora.getTime() - deslocamento * 60 * 1000);
  horaLocal.setHours(horaLocal.getHours() - 24);
  return horaLocal.toISOString();
}

/**
 * Prompt de sistema orientando a IA a resumir com precisão técnica a atividade do desenvolvedor.
 */
const PROMPT_SISTEMA_COLETA = [
  "Você é um assistente sênior de engenharia que resume a atividade de desenvolvimento de uma pessoa, em português do Brasil.",
  "Você receberá uma lista de commits com seus respectivos diffs de código.",
  "Escreva um resumo do dia como se o próprio desenvolvedor estivesse registrando o que realizou.",
  "Destaque objetivamente: o que foi implementado, quais bugs foram corrigidos e qual aprendizado prático foi obtido.",
  "Regra inviolável: Não invente fatos que não estejam nos commits. NUNCA exponha senhas, segredos, tokens ou dados sensíveis.",
  "Se os diffs não evidenciarem um aprendizado profundo, seja honesto e direto, sem forçar conclusões.",
  "Contexto do roadmap: o produto coleta commits do GitHub, sintetiza o DevLog com Gemini ou OpenAI, permite curadoria e publicação no LinkedIn. A evolução prevista inclui configuração de OAuth e variáveis de ambiente, validação local de ponta a ponta, notificações por e-mail, agendamento diário via GitHub Actions, otimização da coleta, carrosséis em PDF, variações de post e aprendizado do estilo de escrita.",
  "No resumo, inclua as seções 'Progresso no plano', 'Próximos 5 passos' e 'Tecnologias e preparações'. Em 'Progresso no plano', relacione apenas os commits às etapas do roadmap. Em 'Próximos 5 passos', apresente nesta ordem: configurar OAuth do Google/GitHub no Supabase; configurar as variáveis de ambiente; validar o fluxo local de ponta a ponta; enviar o resumo diário por e-mail; agendar a coleta diária via GitHub Actions. Em 'Tecnologias e preparações', cite apenas as tecnologias necessárias para esses passos — Supabase, Google Cloud, GitHub OAuth, Gemini/OpenAI, Resend ou SendGrid e GitHub Actions — e a preparação concreta indicada pelo roadmap.",
  "O roadmap é contexto de direção, não prova de execução: não marque uma etapa como concluída sem evidência nos commits e deixe claro quando um próximo passo ainda não foi iniciado.",
  "Utilize tópicos claros e objetivos. Este texto servirá como diário de bordo (DevLog) para a publicação do LinkedIn.",
].join("\n");

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
  const inicioExecucao = new Date().toISOString();
  const runId = idExecucaoSolicitado ?? crypto.randomUUID();

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
      calcularDataInicialPadrao(configuracoes.timezone);

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

    // 5. Busca repositórios ativos do usuário
    await atualizarProgresso(
      "repositorios",
      `Conta conectada (@${loginUsuario}). Localizando repositórios ativos…`,
    );
    const repositorios = await buscarRepositoriosUsuario(idUsuario);

    await atualizarProgresso(
      "commits",
      `${repositorios.length} repositório(s) encontrado(s). Varrendo commits recentes…`,
    );

    const limiteMaximoCommits = configuracoes.max_commits_per_day ?? 15;
    const commitsParaProcessar: Array<{
      repo: string;
      sha: string;
      message: string;
      date?: string;
      url: string;
    }> = [];

    // Varrer até 50 repositórios mais recentes
    for (const repo of repositorios.slice(0, 50)) {
      await atualizarProgresso(
        "commits",
        `Repositório: ${repo.nomeCompleto}. Buscando novos commits…`,
        commitsParaProcessar.length,
        [...new Set(commitsParaProcessar.map((c) => c.repo))],
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
          // Ignora commits que já foram registrados no banco
          if (commitsJaVistos.has(commit.sha)) continue;

          commitsParaProcessar.push({
            repo: repo.nomeCompleto,
            sha: commit.sha,
            message: commit.dados.mensagem,
            url: commit.urlHtml,
            ...(commit.dados.autor?.data ? { date: commit.dados.autor.data } : {}),
          });

          if (commitsParaProcessar.length >= limiteMaximoCommits) break;
        }
      } catch (erro) {
        console.error(`Erro ao consultar commits de ${repo.nomeCompleto}:`, erro);
        throw erro;
      }

      if (commitsParaProcessar.length >= limiteMaximoCommits) break;
    }

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

    // 7. Obtenção detalhada dos diffs com sanitização de ruídos
    const blocosDiffsTexto: string[] = [];
    const repositoriosComCommits = new Set<string>();

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

        // Marca commit como visto para não reprocessar
        await registrarCommitProcessado(
          supabaseAdmin,
          idUsuario,
          commit.repo,
          commit.sha,
          commit.date,
        );
      } catch (erro) {
        console.error(`Erro ao ler detalhes do commit ${commit.sha}:`, erro);
        throw erro;
      }
    }

    if (blocosDiffsTexto.length === 0) {
      throw new Error("Não foi possível ler os diffs dos commits encontrados. Tente novamente.");
    }

    // 8. Síntese Semântica com Inteligência Artificial
    await atualizarProgresso(
      "gerando",
      `${blocosDiffsTexto.length} diff(s) processado(s). Gerando resumo e rascunho com IA…`,
      blocosDiffsTexto.length,
      [...repositoriosComCommits],
    );

    const payloadEntradaIA = [
      `Usuário: ${loginUsuario}`,
      `Período Analisado: ${desdeQuando} até ${inicioExecucao}`,
      `Total de Commits Reais: ${blocosDiffsTexto.length}`,
      "",
      ...blocosDiffsTexto,
    ].join("\n\n");

    let sinteseIA: { summary: string; content: string };
    try {
      sinteseIA = await callAi(PROMPT_SISTEMA_COLETA, payloadEntradaIA);
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

    const dataHoje = new Date().toISOString().slice(0, 10);

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
        tone: configuracoes.default_tone ?? "profissional",
        status: "rascunho",
      })
      .select("id")
      .single();

    if (erroRascunho) throw erroRascunho;

    // 10. Finaliza a rodada com sucesso
    const mensagemSucesso = `Rascunho gerado com sucesso a partir de ${blocosDiffsTexto.length} commit(s).`;

    const { error: erroFinal } = await supabaseAdmin
      .from("collection_runs")
      .update({
        user_id: idUsuario,
        trigger: gatilho,
        since_at: desdeQuando,
        until_at: inicioExecucao,
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
