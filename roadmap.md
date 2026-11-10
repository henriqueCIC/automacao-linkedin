# Roadmap do Projeto — Automação LinkedIn

## Fase 1: Desacoplamento, Usabilidade e Independência
- [x] Remover dependências proprietárias da Lovable (`@lovable.dev/*`, gateways e telemetrias).
- [x] Configurar Vite e TanStack Start com plugins padrões da comunidade (`vite.config.ts`).
- [x] Instalar dependências completas com `npm install`.
- [x] Habilitar autenticação nativa do Supabase (Google OAuth e GitHub OAuth) na tela de login (`/auth`).
- [x] Conectar diretamente à API oficial do GitHub (`api.github.com`) sem gateways intermediários.
- [x] Conectar diretamente à API oficial do LinkedIn (`api.linkedin.com`) com suporte multi-usuário.
- [x] Integrar IA direta com Google Gemini (`GEMINI_API_KEY`) e fallback para OpenAI (`OPENAI_API_KEY`).
- [x] Padronizar design tokens (modo escuro/claro consistente em Fontes, Configurações e Coletas).
- [x] Criar arquivo de variáveis de ambiente documentado (`.env.example`).
- [x] Validar compilação limpa do TypeScript e build do Vite.

## Fase 2: Configuração das Credenciais do Usuário & Execução Local
- [ ] Configurar credenciais do Google Cloud e GitHub OAuth no painel do Supabase.
- [ ] Configurar chaves no arquivo `.env` (Gemini API Key, GitHub OAuth, Supabase).
- [ ] Testar fluxo completo de ponta a ponta em execução local (`npm run dev`).

## Fase 3: Notificações Reais & Robustez
- [ ] Implementar envio de e-mail diário com resumo dos commits e rascunho do dia (via Resend/SendGrid).
- [ ] Disparo automático diário via GitHub Actions acionando o endpoint `/api/public/coletar`.
- [ ] Otimização e paralelização da varredura de repositórios do GitHub.

## Fase 4: Recursos Avançados
- [ ] Gerador de carrosséis visuais (PDF) para LinkedIn a partir dos tópicos do dia.
- [ ] Suporte a múltiplas variações de posts geradas pela IA por dia.
- [ ] Modo "Aprender meu estilo" de escrita para o LinkedIn.
