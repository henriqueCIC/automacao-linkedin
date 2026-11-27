# Histórico de alterações

## Branch `melhoria/fundacao-testes` — Etapas 1 a 4 verificadas localmente (24/11/2026)

Evolução completa de qualidade, confiabilidade da camada de IA, segurança, integridade transacional, observabilidade, CI e testes ponta a ponta (Playwright) sobre a base `0.1.0`.

### Etapa 1 — Fundação de Qualidade
- Configurado Vitest `4.1.12` (`vitest.config.ts`) e scripts `test`, `test:watch` e `typecheck`.
- Extraído `deveIncluirArquivo` para `src/lib/commit-file-filter.ts` com fronteiras de segmento (`build/` vs `rebuild/`) e normalização de separadores.
- Corrigido o tratamento de erro de persistência nos 4 caminhos terminais de `collectForUser` e na leitura de `since_at` (`D03`).
- Regularizado ESLint/Prettier com 0 erros sem desativar regras (`Q01`).

### Etapa 2 — Camada de IA Confiável
- Adicionados schemas Zod de entrada e saída (`src/lib/ai.server.ts`) com rejeição segura de JSON inválido ou truncado (`IA01`).
- Adicionado timeout explícito (`AbortSignal.timeout`), cabeçalho `x-goog-api-key` (sem chave na URL) e fallback automático Gemini → OpenAI (`IA02`).
- Extraído `src/lib/prompts.ts` separando o roadmap interno dos prompts de post e aplicando o tom configurado pelo usuário (`IA03`, `T01`).

### Etapa 3 — Segurança, Integridade, Execução, Observabilidade e CI
- **3.1 Segurança (`S01`–`S04`, `U02`):** `ENCRYPTION_SECRET` de 32 bytes obrigatória, OAuth GitHub com `state` assinado via `HMAC-SHA256` e TTL (`src/lib/oauthState.server.ts`), credencial LinkedIn individual por usuário (`src/lib/linkedin.server.ts`), bloqueio de arquivos sensíveis e sanitização de segredos em diffs (`src/lib/secret-sanitizer.ts`), e isolamento por `user_id` em queries e cache.
- **3.2 Integridade (`D01`, `D02`, `P01`):** Confirmação tardia em lote de `seen_commits` após `day_entries` e `post_drafts`, paginação de repositórios/commits com ordenação cronológica e preservação de `until_at` quando há excedentes, bloqueio de coletas concorrentes e reserva atômica de publicação (`aprovado` → `publicando`) com reconciliação idempotente.
- **3.3 Execução (`A01`, `A02`):** Validação IANA real de fusos horários (`src/lib/timezone.ts`, substituindo `America/Rio_de_Janeiro` por `America/Sao_Paulo`), proteção do cron para só avançar `last_run_date` em caso de `status === "ok"` (`src/lib/cron.server.ts`) e backoff exponencial em chamadas `GET` idempotentes ao GitHub.
- **3.4 Observabilidade:** Eventos operacionais estruturados em JSON de linha única com redação automática de segredos (`src/lib/observability.server.ts`).
- **3.5 CI:** Workflow GitHub Actions (`.github/workflows/ci.yml`) em Node.js 22 LTS.

### Etapa 4 — Interface, Revisão Humana e Testes E2E (Playwright)
- Configurado `@playwright/test@1.65.1` (`playwright.config.ts`) com servidor local de serviços simulados (`tests/e2e/helpers/mock-services-server.mjs`), zero chamadas externas e zero publicação em conta real.
- Adicionada suíte E2E (`tests/e2e/fluxo-principal.spec.ts`) validando autenticação, coleta, revisão/edição de rascunho, aprovação humana obrigatória antes da publicação, confirmação em modal acessível, consulta de status em `/publicacoes`, refinamento com feedback, resiliência a falha da IA, alternância de tema, navegação por `/coletas`, `/fontes` e `/configuracoes`, e isolamento entre usuários.
- Adicionado `src/lib/websocket-compat.ts` para compatibilidade de inicialização do `@supabase/supabase-js` no servidor em Node.js 20.
- Integrada execução E2E e publicação de artefatos (`playwright-report/`, `test-results/`) ao `.github/workflows/ci.yml`.

## 0.1.0 — preparação local em 13/11/2026

Primeiro marco experimental proposto. Ainda não significa tag, release ou envio remoto confirmado.

- Preserva o fluxo atual de coleta, geração, revisão e publicação.
- Incorpora a refatoração local preexistente do coletor e os tipos de domínio.
- Revisa textos de interface e documentação em português, preservando contratos técnicos.
- Documenta falhas conhecidas e o roteiro de qualidade até uma possível adoção de LangGraph.
- Reforça exclusões de ambientes, credenciais e artefatos locais.

Não inclui testes automatizados, correções funcionais de segurança ou garantia de produção. Resultados e limites em `docs/VERIFICACAO_0.1.0.md`.
