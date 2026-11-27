/**
 * @file secret-sanitizer.ts
 * @description Sanitização preventiva de segredos e credenciais em mensagens de commit
 * e diffs de código antes do envio a provedores externos de IA (S04).
 */

export const MARCADOR_SEGREDO_MASCARADO = "[SEGREDO_MASCARADO]";

interface RegraSanitizacaoSegredo {
  nome: string;
  padrao: RegExp;
  substituir: (match: string, ...grupos: string[]) => string;
}

const REGRAS_SEGREDO: readonly RegraSanitizacaoSegredo[] = [
  {
    nome: "Bloco de chave privada PEM",
    padrao: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    substituir: () => MARCADOR_SEGREDO_MASCARADO,
  },
  {
    nome: "Token do GitHub",
    padrao: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    substituir: () => MARCADOR_SEGREDO_MASCARADO,
  },
  {
    nome: "Chave OpenAI ou Anthropic",
    padrao: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{16,}\b/g,
    substituir: () => MARCADOR_SEGREDO_MASCARADO,
  },
  {
    nome: "Chave de API do Google (AIza)",
    padrao: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    substituir: () => MARCADOR_SEGREDO_MASCARADO,
  },
  {
    nome: "Chave secreta do Supabase",
    padrao: /\b(?:sb_secret|sbp)_[A-Za-z0-9_-]{16,}\b/g,
    substituir: () => MARCADOR_SEGREDO_MASCARADO,
  },
  {
    nome: "Access Key ID da AWS",
    padrao: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    substituir: () => MARCADOR_SEGREDO_MASCARADO,
  },
  {
    nome: "Token do Slack",
    padrao: /\bxox[baprs]-[0-9A-Za-z-]{16,}\b/g,
    substituir: () => MARCADOR_SEGREDO_MASCARADO,
  },
  {
    nome: "JSON Web Token (JWT)",
    padrao: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    substituir: () => MARCADOR_SEGREDO_MASCARADO,
  },
  {
    nome: "URL de conexão com senha embutida",
    padrao:
      /\b((?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqps?|https?):\/\/[^/\s:@]+:)([^/\s@]+)(@)/gi,
    substituir: (_match, prefixo, _senha, sufixo) =>
      `${prefixo}${MARCADOR_SEGREDO_MASCARADO}${sufixo}`,
  },
  {
    nome: "Atribuição explícita de segredo ou senha",
    padrao:
      /\b((?:password|passwd|pwd|secret|api_key|apikey|access_token|refresh_token|private_key|service_role_key|client_secret|encryption_secret)\s*[:=]\s*["'`])([^"'`\s]{8,})(["'`])/gi,
    substituir: (_match, prefixo, _valor, sufixo) =>
      `${prefixo}${MARCADOR_SEGREDO_MASCARADO}${sufixo}`,
  },
];

/**
 * Mascara tokens, chaves privadas, senhas em URLs e atribuições de segredos em qualquer texto.
 */
export function sanitizarSegredosEmTexto(texto: string): {
  textoSanitizado: string;
  totalSegredosMascarados: number;
} {
  let textoAtual = texto;
  let totalSegredosMascarados = 0;

  for (const regra of REGRAS_SEGREDO) {
    textoAtual = textoAtual.replace(regra.padrao, (match, ...args) => {
      totalSegredosMascarados += 1;
      const grupos = args.slice(0, -2).map((g) => String(g ?? ""));
      return regra.substituir(match, ...grupos);
    });
  }

  return {
    textoSanitizado: textoAtual,
    totalSegredosMascarados,
  };
}
