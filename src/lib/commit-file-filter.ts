/**
 * @file commit-file-filter.ts
 * @description Módulo puro de filtragem anti-ruído para arquivos alterados em commits.
 * Isolado de dependências de servidor/banco para permitir testes unitários determinísticos
 * e reutilização segura em qualquer camada do projeto.
 */

import type { FiltroArquivo } from "./types";

/**
 * Catálogo documentado de regras de filtro anti-ruído.
 * Cada regra define a expressão regular ancorada por fronteira de segmento,
 * a categoria do artefato e a justificativa técnica pela qual o arquivo é descartado
 * antes do envio ao modelo de IA.
 */
export const REGRAS_FILTRO_ANTI_RUIDO: readonly FiltroArquivo[] = [
  // 1. Lockfiles (árvores de dependências geradas por ferramentas)
  {
    padrao: /(^|\/)package-lock\.json$/,
    categoria: "lockfile",
    justificativa:
      "Lockfile do NPM: gerado automaticamente pela ferramenta de pacotes; polui a leitura com milhares de hashes sem representar lógica autoral.",
  },
  {
    padrao: /(^|\/)yarn\.lock$/,
    categoria: "lockfile",
    justificativa: "Lockfile do Yarn: resolução estrita de pacotes gerenciada pela máquina.",
  },
  {
    padrao: /(^|\/)pnpm-lock\.yaml$/,
    categoria: "lockfile",
    justificativa: "Lockfile do PNPM: metadados de links simbólicos e versões de dependências.",
  },
  {
    padrao: /(^|\/)bun\.lockb?$/,
    categoria: "lockfile",
    justificativa: "Lockfile binário ou textual do Bun: gerenciado internamente pelo runtime.",
  },
  {
    padrao: /(^|\/)composer\.lock$/,
    categoria: "lockfile",
    justificativa: "Lockfile do Composer (PHP): mapeamento de bibliotecas de terceiros.",
  },
  {
    padrao: /(^|\/)Gemfile\.lock$/,
    categoria: "lockfile",
    justificativa: "Lockfile do Ruby/Bundler: controle estrito de versões externas.",
  },
  {
    padrao: /\.lock$/,
    categoria: "lockfile",
    justificativa:
      "Lockfiles genéricos (Poetry, Cargo, etc.): descartados para priorizar código-fonte.",
  },

  // 2. Diretórios de compilação, bundling e testes (ancorados por segmento completo)
  {
    padrao: /(^|\/)dist\//,
    categoria: "build",
    justificativa:
      "Diretório de distribuição: código transpilado, minificado e semântica ilegível.",
  },
  {
    padrao: /(^|\/)build\//,
    categoria: "build",
    justificativa: "Diretório de build de aplicações web ou mobile compiladas.",
  },
  {
    padrao: /(^|\/)\.next\//,
    categoria: "build",
    justificativa: "Cache e compilação interna do Next.js gerada durante o desenvolvimento.",
  },
  {
    padrao: /(^|\/)\.output\//,
    categoria: "build",
    justificativa: "Diretório de saída de servidores modernos (Nitro, Vinxi, Nuxt).",
  },
  {
    padrao: /(^|\/)coverage\//,
    categoria: "build",
    justificativa: "Relatórios HTML e JSON de cobertura de testes automatizados (Jest, Vitest).",
  },

  // 3. Dependências de terceiros e controle do Git
  {
    padrao: /(^|\/)node_modules\//,
    categoria: "dependencia",
    justificativa:
      "Bibliotecas externas da pasta node_modules; nunca devem ser analisadas como código do usuário.",
  },
  {
    padrao: /(^|\/)\.git\//,
    categoria: "dependencia",
    justificativa: "Objetos internos e referências do motor do Git.",
  },

  // 4. Imagens e formatos visuais (diff binário inútil para LLM)
  {
    padrao: /\.(png|jpg|jpeg|gif|ico|webp)$/i,
    categoria: "midia",
    justificativa:
      "Arquivos de imagem binários; não possuem representação textual legível no git diff.",
  },
  {
    padrao: /\.svg$/i,
    categoria: "midia",
    justificativa:
      "Vetores SVG: embora sejam XML, geralmente contêm coordenadas de caminhos longos que gastam milhares de tokens sem agregar contexto de engenharia.",
  },

  // 5. Fontes tipográficas
  {
    padrao: /\.(woff2?|ttf|otf|eot)$/i,
    categoria: "fonte",
    justificativa: "Arquivos binários de fontes tipográficas.",
  },

  // 6. Mídias pesadas e documentos compactados
  {
    padrao: /\.(mp4|mp3|pdf|zip|tar\.gz)$/i,
    categoria: "documento",
    justificativa:
      "Vídeos, áudios, PDFs ou arquivos compactados que não suportam leitura por diff de texto.",
  },
];

/**
 * Avalia se um arquivo alterado no commit deve ser considerado na análise de engenharia.
 * Normaliza separadores de caminho e percorre a lista de regras anti-ruído documentadas.
 *
 * @param nomeArquivo - Caminho relativo do arquivo no repositório.
 * @returns Retorna verdadeiro se o arquivo for código relevante, falso se for ruído descartável.
 */
export function deveIncluirArquivo(nomeArquivo: string): boolean {
  const caminhoNormalizado = nomeArquivo.trim().replace(/\\/g, "/");
  if (!caminhoNormalizado) return false;
  return !REGRAS_FILTRO_ANTI_RUIDO.some((regra) => regra.padrao.test(caminhoNormalizado));
}
