# Preparação da versão inicial 0.1.0

Objetivo: registrar uma base experimental em português, sem credenciais, com diagnóstico e roteiro de evolução.

Execução: neste terminal, sem iniciar a Etapa 1. Preservar as alterações preexistentes do coletor e os tipos de domínio. Não traduzir contratos de APIs, tabelas, imports ou arquivos gerados. Não alterar autenticação, regras de coleta ou publicação.

- [ ] Revisar interface, mensagens e documentação em português.
- [ ] Marcar a versão 0.1.0 no manifesto e lock npm, sem atualizar dependências.
- [ ] Reforçar exclusão de ambientes, credenciais e artefatos locais; verificar arquivos e histórico sem imprimir valores secretos.
- [ ] Documentar problemas conhecidos, limites das verificações e roteiro de curto, médio e longo prazo.
- [ ] Verificar lint, TypeScript, build, diff e interface local. Não simular aprovação de testes inexistentes.
- [ ] Submeter a mesma entrega a duas auditorias independentes, conforme regra global.
- [ ] Somente com destino definido e gate liberado: commit, tag v0.1.0, envio e branch melhoria/fundacao-testes.

Riscos: tradução não pode modificar payloads; o histórico também deve ser inspecionado; a versão experimental não representa aprovação para produção. O lint reprovado e as falhas de segurança são pendências reais do gate, mesmo documentadas.

Graphify: consulta inicial executada com grafo ausente. Após edições, atualização estática concluída (740 nós, 1733 arestas); SQL não coberto por extrator ausente. Impacto conferido também por leitura direta. Context7 indisponível na sessão; nenhuma integração nova será configurada.
