# Rotas da aplicação

As telas ficam em `src/routes/`. O arquivo `__root.tsx` contém a estrutura compartilhada e mantém `<Outlet />` para renderizar as rotas filhas.

| Arquivo | Caminho | Responsabilidade |
| --- | --- | --- |
| `index.tsx` | `/` | Diário e rascunhos |
| `auth.tsx` | `/auth` | Entrada e cadastro |
| `fontes.tsx` | `/fontes` | Conexão GitHub |
| `configuracoes.tsx` | `/configuracoes` | Preferências da coleta |
| `coletas.tsx` | `/coletas` | Histórico de execuções |
| `rascunho.$id.tsx` | `/rascunho/$id` | Revisão e aprovação |
| `publicacoes.tsx` | `/publicacoes` | Publicação e histórico |
| `oauth.github.return.tsx` | `/oauth/github/return` | Retorno da autorização GitHub |
| `api/public/coletar.ts` | `/api/public/coletar` | Recepção do disparo autenticado do cron |

`src/routeTree.gen.ts` é gerado automaticamente. Não editar manualmente. Os nomes técnicos de rotas e contratos foram preservados nesta revisão.
