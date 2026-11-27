# Verificação da Etapa 2 — Camada de IA Confiável

Data: 23/11/2026. Branch: `melhoria/fundacao-testes`.

## Escopo concluído

1. **Validação de entrada e saída com Zod (`src/lib/ai.server.ts` — IA01):**
   - `EntradaChamadaIASchema` valida `system` e `user` antes de qualquer requisição HTTP.
   - `SaidaRascunhoIASchema` valida `summary` (10 a 1.500 chars) e `content` (20 a 3.000 chars — limite oficial de post de texto no LinkedIn).
   - JSON inválido, envelopes corrompidos ou respostas vazias lançam `ErroCamadaIA` tipado (`RESPOSTA_INVALIDA`); nunca retornam texto bruto como rascunho.

2. **Timeout, HTTP 429/5xx, segurança de credenciais e fallback (`src/lib/ai.server.ts` — IA02):**
   - Timeout explícito via `AbortSignal.timeout(timeoutMs)` (padrão 30.000 ms, configurável por `AI_TIMEOUT_MS` ou parâmetro).
   - Chave do Google Gemini enviada exclusivamente pelo cabeçalho `x-goog-api-key` (nunca na query string da URL).
   - Modelo padrão atualizado via Context7 (`/websites/ai_google_dev_gemini-api`): `gemini-3.8-flash` (com suporte a `GEMINI_MODEL`, ex.: `gemini-3.5-flash-lite`) e OpenAI `gpt-4o-mini` (com `OPENAI_MODEL`).
   - Fallback automático **Gemini → OpenAI** acionado quando ambas as chaves estão configuradas e o provedor primário falha por HTTP, rate limit (429), timeout, rede ou JSON inválido.
   - Erros combinados preservam diagnóstico sem expor chaves de API.

3. **Separação de prompts, alinhamento de tons e fechamento de `F01` (`src/lib/prompts.ts`, `src/lib/types.ts`, `src/lib/commit-file-filter.ts` — IA03, T01, F01):**
   - Criado módulo puro `src/lib/prompts.ts` com `normalizarTom`, `construirPromptColetaCommits`, `construirPromptRascunhoManual` e `construirPromptRefinamento`.
   - Removido completamente o roadmap interno hardcoded do prompt de coleta (`collect.server.ts`) e aplicado o tom configurado pelo usuário (`settings.default_tone`).
   - Contrato `TomDeVoz` alinhado em `src/lib/types.ts` para `"profissional" | "narrativo" | "tecnico"` (com alias retrocompatível para `"storytelling"`).
   - Entrada vazia/espaços rejeitada em `deveIncluirArquivo` (`F01` 100% encerrado).

4. **Testes automatizados (zero chamadas externas / zero cobrança):**
   - `tests/integration/ai.server.test.ts` (10 casos integrados com `fetch` simulado).
   - `tests/unit/prompts.test.ts` (7 casos).
   - `tests/unit/commit-file-filter.test.ts` ampliado para 8 casos (incluindo entradas vazias).

## Comandos executados e resultados

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Testes unitários + integração | `npm test` | Saída 0 — 4 arquivos, 30/30 testes aprovados |
| Typecheck | `npm run typecheck` | Saída 0 — 0 diagnósticos |
| Lint | `npm run lint` | Saída 0 — 0 erros, 7 avisos (`react-refresh` em componentes UI) |
| Build produção | `npm run build` | Saída 0 — cliente e servidor compilados |
| Diff limpo | `git diff --check` | Saída 0 |
| Grafo de código | `graphify update .` | Atualizado após as alterações |

## Limites conhecidos remanescentes (planejados para Etapas 3–4)

- Segurança e integridade operacional (Etapa 3): `ENCRYPTION_SECRET` obrigatória sem fallback fixo, validação de `state` no OAuth GitHub, credencial individual do LinkedIn, marcação transacional de `seen_commits`, paginação, validação de fuso horário, concorrência de publicação e CI.
- Testes E2E de interface com Playwright (Etapa 4).
