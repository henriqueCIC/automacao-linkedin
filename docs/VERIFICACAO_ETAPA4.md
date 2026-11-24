# Verificação da Etapa 4 — Interface, Revisão Humana e Testes E2E (Playwright)

Data: 24/11/2026. Branch: `melhoria/fundacao-testes`.

## Escopo concluído

1. **Configuração do Playwright (`playwright.config.ts`, `package.json`):**
   - Instalado `@playwright/test@1.65.1` (consultado via Context7 `/microsoft/playwright`) com navegador Chromium e script `npm run test:e2e`.
   - Configurados `trace: "on-first-retry"`, `screenshot: "only-on-failure"`, relatório HTML (`playwright-report/`) e inicialização automática de servidor isolado em `http://127.0.0.1:5179`.

2. **Ambiente E2E determinístico com serviços simulados (`tests/e2e/helpers/mock-services-server.mjs`, `tests/e2e/helpers/start-e2e-stack.mjs`):**
   - Servidor HTTP local na porta `54329` simulando Supabase GoTrue (`/auth/v1/token`, `/auth/v1/user`, `/auth/v1/logout`), Supabase PostgREST (`/rest/v1/*` com filtro por usuário/RLS e `day_entries(...)` embutido), GitHub REST API (`/github/*`), Google Gemini API (`/gemini/*`) e LinkedIn UGC API (`/linkedin/v2/*`).
   - Suporte a URLs base configuráveis por ambiente apenas no servidor (`GEMINI_API_BASE_URL`, `GITHUB_API_BASE_URL`, `LINKEDIN_API_BASE_URL`) sem alterar o comportamento padrão de produção.
   - **Zero chamadas externas, zero cobrança de APIs de IA e zero publicação em contas reais do LinkedIn.**

3. **Compatibilidade de runtime Node.js 20+ para `@supabase/supabase-js` (`src/lib/websocket-compat.ts`, `src/server.ts`, `src/start.ts`):**
   - Os testes E2E revelaram que, em Node.js 20 sem `--experimental-websocket`, `@supabase/realtime-js` 2.104+ lançava `Node.js detected but native WebSocket not found` ao instanciar `createClient` nas funções de servidor (`requireSupabaseAuth` / `supabaseAdmin`), mesmo sem uso de canais Realtime.
   - Adicionado `garantirWebSocketGlobal()` em `src/lib/websocket-compat.ts` (coberto por `tests/unit/websocket-compat.test.ts`), preservando o `WebSocket` nativo do navegador e do Node.js 22+ e fornecendo construtor inativo seguro em Node.js 20.

4. **Fluxos E2E com seletores acessíveis (`tests/e2e/fluxo-principal.spec.ts`, `src/routes/rascunho.$id.tsx`):**
   - Adicionados `aria-label="Texto do post"` e `aria-label="Complementar o que foi feito"` na tela de revisão de rascunho.
   - **Cenário 1:** Redirecionamento de visitante não autenticado para `/auth`, exibição de erro em credencial inválida e login com sucesso.
   - **Cenário 2:** Coleta simulada de commits do GitHub, redirecionamento automático para `/rascunho/$id`, verificação de que `"Publicar agora"` inicia **desabilitado**, edição do texto com exigência de nova aprovação humana explícita (`"Aprovar este texto"`), modal acessível (`alertdialog`) de confirmação final, publicação apenas no LinkedIn simulado, confirmação tardia de `seen_commits` e conferência de status (`"Publicado e visível"`) em `/publicacoes`.
   - **Cenário 3:** Criação manual de registro do dia, refinamento iterativo com feedback humano e tratamento resiliente de falha HTTP 500 simulada na IA sem perda do texto revisado.
   - **Cenário 4:** Alternância de tema claro/escuro (`Ativar modo claro` / `Ativar modo noturno`), navegação completa por `/coletas`, `/fontes` e `/configuracoes` (com atualização de limite diário), encerramento de sessão e comprovação de isolamento total de dados ao autenticar com segundo usuário (`bruno@exemplo.com`).

5. **Integração no CI (`.github/workflows/ci.yml`):**
   - Adicionados passos de instalação do Chromium (`npx playwright install --with-deps chromium`), execução da suíte E2E (`npm run test:e2e`) e publicação de `playwright-report/` e `test-results/` via `actions/upload-artifact@v4`.

## Comandos executados e resultados

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Testes unitários + integração | `npm test` | Saída 0 — 8 arquivos, 56/56 testes aprovados |
| Testes ponta a ponta (E2E) | `npm run test:e2e` | Saída 0 — 4/4 fluxos E2E aprovados no Chromium |
| Typecheck | `npm run typecheck` | Saída 0 — 0 diagnósticos |
| Lint | `npm run lint` | Saída 0 — 0 erros, 7 avisos (`react-refresh` em componentes UI) |
| Build produção | `npm run build` | Saída 0 — cliente e servidor compilados |
| Diff limpo | `git diff --check` | Saída 0 |
| Grafo de código | `graphify update .` | Atualizado após as alterações |
