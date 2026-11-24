# Roteiro de evolução

## Objetivo do produto e da carreira

Construir um case de automação com IA que possa ser explicado, testado e recuperado após falhas. Demonstrar TypeScript, HTTP, autenticação, PostgreSQL, qualidade, IA aplicada e, somente depois, agentes com estado.

## Preparação da versão 0.1.0

Registrar a base experimental, revisar português e documentação, excluir credenciais, demonstrar a interface local e registrar erros conhecidos. O envio depende do repositório de destino, das verificações e das duas auditorias independentes previstas nas regras do workspace. Não declarar a versão publicada antes de confirmar o remoto.

## Curto prazo — Etapa 1: fundação de qualidade

- Consultar Context7 antes de definir versões e configuração do Vitest.
- Criar `tests/unit/` e extrair `deveIncluirArquivo` para módulo puro.
- Testar código relevante, lockfiles, mídia, diretórios gerados e limites de segmentos como `build/` versus `rebuild/`.
- Preservar os tipos e alterações existentes; não refatorar toda a coleta.
- Adicionar scripts de testes e typecheck, documentação e fixtures determinísticas quando necessárias.
- Regularizar lint em subentrega explícita, sem desativar regras para mascarar falhas.

Saída: testes reproduzíveis, lint, typecheck e build aprovados, revisão registrada e aprovação do usuário.

## Curto prazo — Etapa 2: camada de IA confiável

- Validar entradas e saídas com schemas.
- Tratar JSON inválido, respostas vazias/incompletas, timeout, rate limit e falhas HTTP.
- Definir fallback, limites de conteúdo e modelos disponíveis com documentação atual.
- Separar o roadmap de desenvolvimento do prompt de posts e aplicar o tom escolhido.
- Criar `tests/integration/` com respostas simuladas e sem cobrança de APIs.

Saída: nenhuma resposta inválida chega ao banco ou à interface sem tratamento; testes de regressão e verificação completa.

## Médio prazo — Etapa 3: automação, segurança e observabilidade

Dividir em entregas aprovadas individualmente:

1. Segurança: chave obrigatória, OAuth com state validado, credencial LinkedIn individual, tratamento de dados sensíveis e isolamento entre usuários.
2. Integridade: confirmação do processamento, transações, paginação, recuperação e proteção contra concorrência. Publicações com resultado incerto exigem reconciliação antes de repetir.
3. Execução: datas e fusos válidos, cron coerente, tentativas limitadas e backoff seguro.
4. Observabilidade: identificador, estado, duração, contagens, modelo, falhas e custo/latência quando disponíveis; sem segredos nos logs.
5. CI: verificações em pull requests com GitHub Actions e ambiente isolado.

Saída: execuções rastreáveis, recuperação testada, isolamento comprovado e proteção contra duplicação. Segurança é bloqueio de produção, não recurso opcional.

## Médio prazo — Etapa 4: interface e revisão humana

- Introduzir Playwright após consulta à documentação atual.
- Criar `tests/e2e/` com fluxos de autenticação, coleta, rascunho, edição e aprovação.
- Usar serviços simulados para publicação; não publicar em conta real nos testes.
- Usar seletores acessíveis, traces, relatórios e CI.
- Validar erros, carregamento, navegação e troca de usuário.

Saída: fluxo principal protegido por testes estáveis, aprovação humana preservada e evidências no CI.

## Longo prazo — Etapa 5: agente com LangGraph

Somente após aprovação das etapas 1 a 4. Avaliar a utilidade antes de adotar o framework; LangChain apenas se houver necessidade real.

Fluxo pretendido: coletar → filtrar → sintetizar → gerar → validar → interromper para revisão humana → publicar pela API oficial.

- Responsabilidades pequenas e testadas por nó.
- Estado persistido, checkpoints e retomada segura.
- Ferramentas com contratos e permissões explícitos.
- Aprovação vinculada à versão exata do conteúdo.
- Avaliações de qualidade, custo e latência.

Saída: agente observável, recuperável, interrompível e documentado. O framework não substitui as garantias de integridade.

## Evoluções posteriores de produto

Calendário editorial, notificações reais, variações de texto, personalização de estilo e carrosséis/PDF. Cada recurso exige escopo e aprovação próprios; não faz parte da preparação da 0.1.0.

## Política de trabalho

- Uma etapa ou subetapa por vez; nunca avançar automaticamente.
- Antes de editar: regras, mapa de impacto, skills, plano e documentação atual de bibliotecas via Context7.
- Preservar alterações existentes e não publicar segredos, arquivos de ambiente ou dados privados.
- Verificações obrigatórias e duas auditorias independentes antes de envio remoto, conforme regras do workspace.
- Relatório: etapa; arquivos; implementação e motivo; verificações; problemas; limitações; próxima etapa; AGUARDANDO APROVAÇÃO.
- `0.1.0` identifica a base experimental; versões posteriores registram entregas efetivamente verificadas no CHANGELOG. Não reservar números como promessa de conclusão.
