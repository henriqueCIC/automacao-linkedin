# Item 5 — Mais fontes de atividade

Hoje a coleta olha os seus commits em até 50 repositórios, sem escolha e sem incluir pull requests ou issues. Este item resolve isso.

## O que você vai ver

### 1. Escolher repositórios (na tela Fontes)

- Depois de conectar o GitHub, a tela lista seus repositórios, do mais recente ao mais antigo, com uma caixinha em cada um.
- Um interruptor no topo: **"Acompanhar todos"** (padrão, como é hoje) ou **"Acompanhar só os que eu marcar"**.
- Marcação salva na hora, com busca por nome para achar rápido num monte de repositórios.
- Quando a lista estiver limitada, a coleta olha apenas os marcados — o que deixa a coleta mais rápida e mais barata.

### 2. Pull requests e issues

- Na tela Fontes, três chaves: **commits**, **pull requests** e **issues**. Commits vêm ligados; as outras duas você liga se quiser.
- Ligadas, a coleta também busca os pull requests que você abriu, atualizou ou teve aprovados no período, e as issues que você abriu ou fechou.
- Esse material entra no resumo junto com os commits, identificado como tal: o rascunho passa a poder falar de "fechei a issue X" e "revisão do PR Y", não só de código.
- Na tela Coletas, cada execução passa a mostrar quantos commits, PRs e issues foram encontrados.

### 3. Importar atividade manualmente

- Na tela Fontes, um espaço **"Colar atividade"**: você cola texto de qualquer ferramenta (Jira, Linear, Notion, anotações) e isso entra como registro do dia, pronto para gerar rascunho.
- É o caminho de hoje para ferramentas sem integração, e a base para a futura extensão do VS Code: a mesma porta de entrada.

## O que não muda

Nada disso publica sozinho. Todo rascunho continua passando por revisão, aprovação e confirmação final antes de ir para o LinkedIn.

## Detalhes técnicos

**Banco (migração):**
- `tracked_repositories` (`user_id`, `repo_full_name`, `enabled`, `created_at`) com RLS por `auth.uid()` e GRANTs para `authenticated`/`service_role`; chave única em (`user_id`, `repo_full_name`).
- `automation_settings` ganha `track_all_repos boolean default true`, `include_pull_requests boolean default false`, `include_issues boolean default false`.
- `collection_runs` ganha `pull_requests_found int default 0` e `issues_found int default 0`.
- `seen_commits` continua para commits; PRs e issues entram numa tabela `seen_activity` (`user_id`, `kind`, `repo_full_name`, `external_id`, `updated_at_source`) para não repetir o mesmo item em coletas seguidas.

**Coleta (`src/lib/collect.server.ts`):**
- Lista de repositórios passa a vir de `tracked_repositories` quando `track_all_repos = false`.
- PRs via `GET /search/issues?q=author:{login}+type:pr+updated:>={since}`; issues via `...+type:issue`. Fallback silencioso se a busca falhar (rate limit), registrado na execução.
- Cada item vira um bloco de texto curto (título, repositório, situação, link, corpo truncado) anexado ao prompt já existente; o `COLLECT_SYSTEM` ganha instrução para distinguir código, revisão e planejamento, mantendo "não invente fatos".
- Retorno de `collectForUser` passa a incluir `pullRequestsFound` e `issuesFound`; a condição de "nada novo" considera os três tipos.

**Server functions (`src/lib/collect.functions.ts` / novo `repos.functions.ts`):**
- `listGitHubRepositories` (busca `/user/repos` e cruza com `tracked_repositories`), `setTrackedRepositories`, `importActivityText` (cria `day_entries` com `source = "manual_import"`).
- `updateAutomationSettings` aceita os três novos campos.

**Telas:**
- `src/routes/fontes.tsx`: seleção de repositórios com busca, chaves de commits/PRs/issues, e o campo de colar atividade.
- `src/routes/coletas.tsx`: exibe as contagens por tipo.

## Ordem de implementação

1. Migração (tabelas e colunas novas)
2. Coleta: repositórios escolhidos
3. Coleta: pull requests e issues
4. Tela Fontes (seleção, chaves, colar atividade)
5. Tela Coletas com as contagens
6. Teste do fluxo completo
