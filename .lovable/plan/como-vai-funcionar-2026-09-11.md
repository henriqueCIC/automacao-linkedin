- Resumo automático a partir dos seus commits do GitHub

## Como vai funcionar

1. Você entra com o GitHub uma única vez, autorizando a leitura da sua atividade (inclui repositórios privados).
2. O app olha os seus commits do dia em qualquer repositório onde você commitou.
3. Para cada commit novo desde a última verificação, ele lê as diferenças de código em relação à versão anterior lendo o arquivo por inteiro 2 vezes, a versao anterior e a versao atual, afim de ter uma analise mais assertiva sobre a diferenca existente e seu contexto.
4. Com base nessas diferenças, a IA escreve: o que foi feito, o que foi corrigido e o que você provavelmente aprendeu ali.
5. Esse texto entra como registro do dia e vira um rascunho de post, que continua passando pela sua revisão, aprovação e confirmação final antes de ir para o LinkedIn.  
6. um lembrete será enviado para o gmail correspondente ou para a area de notificacoes do usuario no desktop macOS , afim de ficar pendente sua continuidade

Nada muda na regra de publicação: sem sua aprovação e confirmação, nada é publicado.

## Telas

- **Fontes** (`/fontes`) — botão "Entrar com o GitHub", nome da conta conectada, opção de desconectar. Explica que arquivos locais no VS Code não podem ser lidos pelo navegador, então a fonte é o GitHub.
- **Configurações** (`/configuracoes`) — horário da coleta diária, fuso horário, estilo padrão do post e limite de commits por dia.
- **Coletas** (`/coletas`) — histórico de cada verificação: quando rodou, quantos commits achou, em quais repositórios, e link para o rascunho gerado. Mostra também quando não havia nada novo.
- **Diário** (`/`) — ganha um botão "Buscar meus commits agora" e um aviso quando a coleta do dia já rodou, feedback na tela.

## O que a IA recebe

Para cada commit: repositório, mensagem, hora, arquivos alterados e as linhas adicionadas/removidas (o diff), com limite de tamanho por commit e por dia para não estourar custo. Arquivos gerados (lock files, build, imagens) são ignorados. A instrução deixa claro: não inventar fatos, não expor segredos ou trechos sensíveis de código, e falar de aprendizado apenas quando o diff sustentar isso.

## Detalhes técnicos

- **Acesso por usuário:** App User Connector do GitHub (`connector_app_user--list_connectors` → `connect_client`), com escopos `read:user` e `repo`. Chave de conexão de cada usuário guardada cifrada em `app_user_connections` (`APP_USER_CONNECTION_KEY_SECRET`), lida só por server functions com service role.
- **Novas tabelas:** `automation_settings` (horário, fuso, estilo padrão, limites), `collection_runs` (janela coletada, commits encontrados, repositórios, rascunho gerado, erro), `seen_commits` (sha + repo por usuário, evita reprocessar). RLS por `user_id` + GRANTs.
- **Coleta:** `GET /user/repos?sort=pushed` para achar repositórios ativos; `GET /repos/{owner}/{repo}/commits?author={login}&since={última execução}`; depois `GET /repos/{owner}/{repo}/commits/{sha}` para ler os `patch` de cada arquivo. Diffs truncados por arquivo e por commit. `403` com `X-RateLimit-Remaining: 0` é mostrado como "limite do GitHub atingido", sem repetir a chamada.
- **Lógica compartilhada** em `src/lib/collect.server.ts`, chamada por: server function autenticado (`coletarAgora`) e rota pública de cron `src/routes/api/public/coletar.ts` protegida por `LOVABLE_CRON_SECRET`.
- **Agendamento:** um cron por hora chamando a rota pública; para cada usuário compara a hora local no fuso configurado e grava a execução do dia para não duplicar. Consequência: o post pode sair até 1 hora depois do horário escolhido, e um cron de hora em hora mantém o banco ativo, o que soma custo — se preferir, uso apenas o botão manual.
- Geração de texto reaproveita o gateway de IA já usado em `drafts.functions.ts`; o rascunho nasce com status `rascunho`.