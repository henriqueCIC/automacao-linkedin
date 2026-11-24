# Verificação da Subetapa 3.1 — Segurança e Isolamento

Data: 23/11/2026. Branch: `melhoria/fundacao-testes`.

## Escopo concluído

1. **`S01` — Chave de criptografia obrigatória de 32 bytes (`src/lib/connectionKeyCrypto.server.ts`):**
   - Removido o fallback fixo de desenvolvimento (`0123456789abcdef...`).
   - `obterChaveMestraCriptografia()` exige `ENCRYPTION_SECRET` (ou `APP_USER_CONNECTION_KEY_SECRET`) com exatamente 32 bytes após decodificação base64 e valida tamanho mínimo do ciphertext em `decryptConnectionKey`.

2. **`S02` — OAuth GitHub com `state` assinado e validado (`src/lib/oauthState.server.ts`, `src/lib/githubOAuth.functions.ts`, `src/routes/oauth.github.return.tsx`):**
   - `gerarStateOAuth` emite `payload.assinatura` com `userId`, timestamp, nonce de 16 bytes e HMAC-SHA256 derivado da chave mestra.
   - `validarStateOAuth` verifica a assinatura em tempo constante (`timingSafeEqual`), confere igualdade estrita com o `userId` autenticado e aplica janela de expiração (TTL de 10 minutos).
   - `completeGitHubOAuth` e a rota `/oauth/github/return` exigem `code` e `state` antes de contatar o GitHub.

3. **`S03` — Credencial LinkedIn individual por usuário (`src/lib/linkedin.functions.ts`):**
   - `obterTokenLinkedInDoUsuario` consulta exclusivamente a conexão individual do usuário (`app_user_connections` para `connector_id = "linkedin"`).
   - Removido o fallback global `LINKEDIN_ACCESS_TOKEN` / `LINKEDIN_API_KEY` para impedir compartilhamento acidental de conta entre usuários.

4. **`S04` — Bloqueio de arquivos sensíveis e sanitização de segredos em diffs (`src/lib/secret-sanitizer.ts`, `src/lib/commit-file-filter.ts`, `src/lib/collect.server.ts`):**
   - `deveIncluirArquivo` bloqueia `.env`, `.env.*` (preservando `.env.example`/`.template`/`.sample`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`, `.npmrc`, `credentials.json` e `service-account*.json`.
   - `sanitizarSegredosEmTexto` mascara blocos PEM, tokens GitHub (`ghp_/gho_/github_pat_`), chaves OpenAI/Anthropic (`sk-`), Google (`AIza`), Supabase (`sb_secret_/sbp_`), AWS (`AKIA/ASIA`), Slack (`xox*`), JWTs, URLs com senha e atribuições de segredos antes de montar o prompt da IA.

5. **Isolamento entre usuários (`U02`) e verificação de persistência (`D03`):**
   - Adicionado filtro `.eq("user_id", userId)` explícito em `drafts.functions.ts`, `linkedin.functions.ts`, `index.tsx`, `publicacoes.tsx` e `rascunho.$id.tsx`.
   - Incluído `userId` nas `queryKey`s de cache do TanStack Query em `publicacoes.tsx` e `rascunho.$id.tsx`.
   - Adicionada verificação de erro nas operações de `appUserConnections.server.ts` e atualização de publicação em `linkedin.functions.ts`.

## Comandos executados e resultados

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Testes unitários + integração | `npm test` | Saída 0 — 5 arquivos, 39/39 testes aprovados |
| Typecheck | `npm run typecheck` | Saída 0 — 0 diagnósticos |
| Lint | `npm run lint` | Saída 0 — 0 erros, 7 avisos (`react-refresh` em componentes UI) |
| Build produção | `npm run build` | Saída 0 — cliente e servidor compilados |
| Diff limpo | `git diff --check` | Saída 0 |
| Grafo de código | `graphify update .` | Atualizado após as alterações |
