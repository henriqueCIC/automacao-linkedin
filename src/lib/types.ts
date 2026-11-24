/**
 * @file types.ts
 * @description Modelagem e Tipagem de Domínio da Automação de LinkedIn.
 * Centraliza os contratos de dados de ingestão do GitHub, processamento de IA,
 * persistência de rascunhos e controle de rotinas automáticas.
 */

// ============================================================================
// 1. Tipos e Modelos de Integração com o GitHub
// ============================================================================

/**
 * Representa os dados essenciais de um repositório consultado via API do GitHub.
 */
export interface RepositorioGitHub {
  /** Nome completo do repositório no formato 'proprietario/nome-repo' (ex: 'henrique/meu-app') */
  nomeCompleto: string;
  /** Nome do dono ou organização proprietária do repositório */
  dono: string;
  /** Nome simples do repositório */
  nome: string;
  /** Data e hora ISO do último commit ou push realizado no repositório */
  ultimoPushEm: string | null;
  /** Indica se o repositório é privado */
  privado: boolean;
}

/**
 * Detalhe de uma alteração de arquivo dentro de um commit.
 */
export interface ArquivoAlterado {
  /** Caminho relativo do arquivo (ex: 'src/lib/collect.server.ts') */
  caminho: string;
  /** Estado da alteração do arquivo */
  status: "adicionado" | "modificado" | "removido" | "renomeado";
  /** Quantidade de linhas inseridas */
  linhasAdicionadas: number;
  /** Quantidade de linhas deletadas */
  linhasRemovidas: number;
  /** Trecho textual do diff/patch (quando disponível e abaixo do limite de tamanho) */
  patch?: string | undefined;
}

/**
 * Representa um commit bruto obtido diretamente da API v3 do GitHub.
 */
export interface CommitBrutoGitHub {
  /** Hash identificador único do commit (SHA de 40 caracteres) */
  sha: string;
  /** URL pública ou de API para visualização do commit */
  urlHtml: string;
  /** Metadados internos do commit */
  dados: {
    /** Mensagem escrita pelo desenvolvedor ao commitar */
    mensagem: string;
    /** Informações sobre o autor do commit */
    autor?: {
      nome?: string | undefined;
      email?: string | undefined;
      /** Data ISO do momento em que o commit foi gerado */
      data?: string | undefined;
    };
  };
}

/**
 * Especificação de regra para filtragem e descarte de arquivos que não agregam
 * valor de engenharia à análise semântica da IA (ruídos, binários e metadados de máquinas).
 */
export interface FiltroArquivo {
  /** Expressão regular correspondente ao caminho ou extensão do arquivo */
  padrao: RegExp;
  /** Categoria técnica do arquivo descartado */
  categoria: "lockfile" | "build" | "dependencia" | "midia" | "fonte" | "documento";
  /** Explicação detalhada do motivo técnico do descarte */
  justificativa: string;
}

/**
 * Commit após passar pela esteira de filtragem e higienização.
 * Contém apenas arquivos autorais e relevantes para a síntese da IA.
 */
export interface CommitSanitizado {
  /** Hash único do commit */
  sha: string;
  /** Repositório ao qual o commit pertence ('proprietario/repo') */
  repositorio: string;
  /** Mensagem do commit limpa (sem tags automáticas de merge ou co-author) */
  mensagem: string;
  /** Data em que o commit foi registrado */
  dataCommit: string;
  /** Lista de arquivos com alterações reais de código */
  arquivosRelevantes: ArquivoAlterado[];
  /** Total de linhas adicionadas e removidas somadas */
  totalModificacoes: number;
}

/** Alias de compatibilidade */
export type CommitHigienizado = CommitSanitizado;

// ============================================================================
// 2. Tipos de Execução da Coleta & Desduplicação
// ============================================================================

/**
 * A origem do disparo da coleta de commits.
 */
export type OrigemGatilhoColeta = "manual" | "cron";

/**
 * Parâmetros de entrada para disparar uma rotina de coleta de commits.
 */
export interface ParametrosColeta {
  /** ID do usuário autenticado no sistema (UUID do Supabase auth.users) */
  idUsuario: string;
  /** Quem disparou a rotina: 'manual' (usuário clicou) ou 'cron' (agendamento) */
  gatilho: OrigemGatilhoColeta;
  /** Data inicial de busca de commits (padrão: 24 horas atrás) */
  desdeQuando?: Date | undefined;
  /** Força a re-coleta mesmo que o limite diário de execuções tenha sido atingido */
  ignorarIntervaloMinimo?: boolean | undefined;
}

/**
 * Status final de uma rodada de coleta de dados.
 */
export type StatusExecucaoColeta = "sucesso" | "sem_commits" | "aviso" | "erro";

/**
 * Resultado completo retornado ao final da rotina de ingestão de commits.
 */
export interface ResultadoColeta {
  /** Status geral da operação */
  status: StatusExecucaoColeta;
  /** Quantidade total de commits novos encontrados e higienizados */
  totalCommitsEncontrados: number;
  /** Lista dos nomes dos repositórios que tiveram commits analisados */
  repositoriosAnalisados: string[];
  /** ID do registro diário gerado na tabela 'day_entries' */
  idEntradaDiaria?: string | undefined;
  /** ID do rascunho de post gerado pela IA na tabela 'post_drafts' (se houver) */
  idRascunhoPost?: string | undefined;
  /** Mensagem descritiva e amigável em português sobre o que ocorreu */
  mensagem: string;
}

/**
 * Notificação de progresso enviada durante execuções longas.
 */
export interface NotificacaoProgresso {
  /** Etapa textual descritiva (ex: 'Consultando repositórios', 'Analisando commits') */
  etapa: string;
  /** Percentual estimado de conclusão (0 a 100) */
  percentual: number;
  /** Total de itens previstos para processamento */
  totalItens?: number | undefined;
  /** Total de itens concluídos até o momento */
  itensProcessados?: number | undefined;
}

// ============================================================================
// 3. Tipos do Motor de Inteligência Artificial & Conteúdo
// ============================================================================

/**
 * Tons de escrita suportados para a redação dos posts no LinkedIn.
 * Alinhado aos contratos das telas, configurações de automação e server functions.
 */
export type TomDeVoz = "profissional" | "narrativo" | "tecnico";

/**
 * Estrutura do payload retornado pela IA (Gemini ou OpenAI) após analisar os commits.
 */
export interface RascunhoGeradoIA {
  /** Resumo executivo em 1 ou 2 frases sobre o que foi desenvolvido no dia */
  resumo: string;
  /** Conteúdo textual completo, formatado com ganchos, quebras e emojis para o LinkedIn */
  conteudoPost: string;
}

// ============================================================================
// 4. Tipos de Publicação e Status de Ciclo de Vida
// ============================================================================

/**
 * Estados possíveis de um rascunho de post no sistema.
 */
export type StatusRascunho = "rascunho" | "aprovado" | "rejeitado" | "publicado";

/**
 * Modelo de dados completo de um rascunho de publicação.
 */
export interface RascunhoPostCompleto {
  id: string;
  idUsuario: string;
  idEntradaDiaria?: string | null;
  resumo: string;
  conteudo: string;
  tom: TomDeVoz;
  status: StatusRascunho;
  feedbackUsuario?: string | null;
  aprovadoEm?: string | null;
  publicadoEm?: string | null;
  idPostLinkedIn?: string | null;
  criadoEm: string;
  atualizadoEm: string;
}
