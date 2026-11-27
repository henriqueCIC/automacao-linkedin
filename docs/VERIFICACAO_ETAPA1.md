# Verificação da Etapa 1 — Fundação de Qualidade

Data: 23/11/2026. Branch: `melhoria/fundacao-testes`.

## Escopo concluído

1. **Subetapa 1A — Testes unitários e correções das regressões da auditoria 0.1.0:**
   - Versão do Vitest definida via Context7 (`/vitest-dev/vitest`): `vitest@4.1.12` (compatível com `Node 20.20.2` e `Vite 8.1.5`).
   - Criado `vitest.config.ts` isolado dos plugins SSR do TanStack Start.
   - Extraído filtro anti-ruído puro para `src/lib/commit-file-filter.ts` (re-exportado em `src/lib/collect.server.ts`).
   - Corrigidos os limites de segmento nas regexes (`/(^|\/)build\//`, `/(^|\/)dist\//`, `/(^|\/)coverage\//`, `/(^|\/)node_modules\//`, lockfiles) e normalização de separadores `\`.
   - Restaurada a checagem de erro de banco nos 4 caminhos terminais de `collectForUser` (autenticação, zero commits, IA e sucesso) e na atualização de `since_at`.
   - Criada suíte determinística em `tests/unit/commit-file-filter.test.ts` (7 casos) e `tests/unit/collect-persistence.test.ts` (5 casos), reproduzindo antes da correção (RED) e validando após a correção (GREEN).
   - Adicionados scripts `test`, `test:watch` e `typecheck` em `package.json`.

2. **Subetapa 1B — Regularização do Lint (sem desativar regras):**
   - Corrigido `prefer-const` em `src/routes/fontes.tsx`.
   - Corrigido aviso `react-hooks/exhaustive-deps` e tipagem do tom em `src/routes/configuracoes.tsx`.
   - Regularizada formatação Prettier nos arquivos TypeScript/TSX verificados pelo ESLint.

## Comandos executados e resultados

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Testes unitários | `npm test` | Saída 0 — 2 arquivos, 12/12 testes aprovados |
| Typecheck | `npm run typecheck` | Saída 0 — 0 diagnósticos |
| Lint | `npm run lint` | Saída 0 — 0 erros, 7 avisos (`react-refresh` em componentes UI) |
| Build produção | `npm run build` | Saída 0 — cliente e servidor compilados |
| Diff limpo | `git diff --check` | Saída 0 |
| Grafo de código | `graphify update .` | Reconstruído: 767 nós, 1776 arestas, 61 comunidades |

## Limites conhecidos remanescentes (planejados para Etapas 2–4)

- Camada de IA (`src/lib/ai.server.ts`) ainda não possui validação de schema Zod, timeout, fallback automático após falha ou testes de integração (Etapa 2).
- Segurança/integridade avançadas (`ENCRYPTION_SECRET` obrigatória, OAuth `state`, LinkedIn individual, paginação/concorrência) permanecem para a Etapa 3.
- Variáveis `.env` de execução real (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GITHUB_CLIENT_ID/SECRET`, `LINKEDIN_ACCESS_TOKEN`) continuam apenas locais e ainda vazias.
