/**
 * @file prompts.ts
 * @description Módulo puro para normalização de tons de voz e construção de prompts de geração
 * e refinamento de posts para o LinkedIn. Mantém o conteúdo dos posts completamente desacoplado
 * do roadmap interno do projeto.
 */

import type { TomDeVoz } from "./types";

/** Tom padrão utilizado quando o usuário não define preferência válida */
export const TOM_PADRAO: TomDeVoz = "profissional";

/** Descrições diretivas enviadas à IA para cada tom de voz suportado */
export const DESCRICAO_TONS: Record<TomDeVoz, string> = {
  profissional: "profissional, direto e focado em resultado e clareza técnica",
  narrativo: "narrativa pessoal e humana, contando o contexto e a jornada do dia",
  tecnico: "técnico e detalhado, explicando decisões arquiteturais, trade-offs e aprendizados",
};

/**
 * Normaliza qualquer string de tom recebida do banco ou da interface para um TomDeVoz válido.
 * Aceita 'storytelling' como alias retrocompatível para 'narrativo'.
 */
export function normalizarTom(tom?: string | null): TomDeVoz {
  const valor = tom?.trim().toLowerCase();
  if (valor === "profissional" || valor === "narrativo" || valor === "tecnico") {
    return valor;
  }
  if (valor === "storytelling") {
    return "narrativo";
  }
  return TOM_PADRAO;
}

/** Prompt de sistema base para transformar commits do GitHub em resumo + rascunho de post */
export const PROMPT_SISTEMA_COLETA = [
  "Você é um assistente de engenharia e redator de posts técnicos para LinkedIn, em português do Brasil.",
  "Você receberá commits reais e seus diffs sanitizados, além do tom de voz escolhido pela pessoa.",
  "Devolva um objeto JSON com exatamente dois campos obrigatórios:",
  "- summary: um resumo objetivo em tópicos curtos (2 a 4 frases) do que foi implementado, corrigido ou aprendido nos commits.",
  "- content: um rascunho de post pronto para o LinkedIn em primeira pessoa, respeitando o tom solicitado, entre 400 e 1800 caracteres (máximo absoluto de 2800), com no máximo 3 hashtags relevantes ao final e sem excesso de emojis.",
  "Regras invioláveis:",
  "1. Nunca invente fatos, métricas, clientes ou entregas que não estejam presentes nos commits fornecidos.",
  "2. Nunca exponha senhas, tokens, chaves de API, e-mails privados ou segredos de código.",
  "3. Se os diffs forem pequenos ou diretos, mantenha o texto honesto e enxuto, sem forçar grandes lições artificiais.",
  "4. Não inclua roadmaps genéricos, planos futuros não citados nos commits ou instruções internas do sistema.",
].join("\n");

/** Prompt de sistema base para transformar anotações manuais em resumo + rascunho de post */
export const PROMPT_SISTEMA_RASCUNHO_MANUAL = [
  "Você é um redator de posts para LinkedIn, em português do Brasil.",
  "Você receberá as anotações do dia de trabalho de uma pessoa e o tom de voz desejado.",
  "Devolva um objeto JSON com exatamente dois campos obrigatórios:",
  "- summary: um resumo curto (2 a 4 frases) do que a pessoa fez no dia, em tópicos claros de leitura rápida.",
  "- content: o rascunho do post para o LinkedIn, entre 400 e 1800 caracteres (máximo absoluto de 2800), primeira pessoa, respeitando o tom solicitado, sem hashtags exageradas (no máximo 3 ao final) e sem emojis em excesso.",
  "Regras invioláveis: nunca invente números, nomes de clientes ou resultados ausentes nas anotações; se as anotações forem vagas, seja honesto e direto.",
].join("\n");

export interface EntradaPromptColeta {
  loginUsuario: string;
  desdeQuando: string;
  ateQuando: string;
  blocosCommits: readonly string[];
  tom?: string | null;
}

/**
 * Monta o par `{ system, user, tomAplicado }` para síntese de commits do GitHub.
 */
export function construirPromptColetaCommits(entrada: EntradaPromptColeta): {
  system: string;
  user: string;
  tomAplicado: TomDeVoz;
} {
  const tomAplicado = normalizarTom(entrada.tom);

  const user = [
    `Autor no GitHub: ${entrada.loginUsuario}`,
    `Período analisado: ${entrada.desdeQuando} até ${entrada.ateQuando}`,
    `Tom desejado para o post: ${tomAplicado} (${DESCRICAO_TONS[tomAplicado]})`,
    `Total de commits analisados: ${entrada.blocosCommits.length}`,
    "",
    ...entrada.blocosCommits,
  ].join("\n\n");

  return {
    system: PROMPT_SISTEMA_COLETA,
    user,
    tomAplicado,
  };
}

export interface EntradaPromptManual {
  dataEntrada: string;
  anotacoes: string;
  tom?: string | null;
}

/**
 * Monta o par `{ system, user, tomAplicado }` para rascunhos criados a partir de anotações manuais.
 */
export function construirPromptRascunhoManual(entrada: EntradaPromptManual): {
  system: string;
  user: string;
  tomAplicado: TomDeVoz;
} {
  const tomAplicado = normalizarTom(entrada.tom);

  const user = [
    `Data: ${entrada.dataEntrada}`,
    `Tom desejado: ${tomAplicado} (${DESCRICAO_TONS[tomAplicado]})`,
    "Anotações do dia:",
    entrada.anotacoes,
  ].join("\n");

  return {
    system: PROMPT_SISTEMA_RASCUNHO_MANUAL,
    user,
    tomAplicado,
  };
}

export interface EntradaPromptRefinamento {
  anotacoesOriginais: string;
  conteudoAtual: string;
  feedbackUsuario: string;
  tom?: string | null;
}

/**
 * Monta o par `{ system, user, tomAplicado }` para refinamento iterativo de um rascunho existente.
 */
export function construirPromptRefinamento(entrada: EntradaPromptRefinamento): {
  system: string;
  user: string;
  tomAplicado: TomDeVoz;
} {
  const tomAplicado = normalizarTom(entrada.tom);

  const user = [
    `Tom desejado: ${tomAplicado} (${DESCRICAO_TONS[tomAplicado]})`,
    "Anotações originais do dia:",
    entrada.anotacoesOriginais,
    "",
    "Versão atual do post:",
    entrada.conteudoAtual,
    "",
    "Ajustes pedidos pela pessoa (siga à risca):",
    entrada.feedbackUsuario,
  ].join("\n");

  return {
    system: PROMPT_SISTEMA_RASCUNHO_MANUAL,
    user,
    tomAplicado,
  };
}
