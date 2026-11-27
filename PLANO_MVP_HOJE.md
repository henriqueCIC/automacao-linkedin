> **Plano histórico, substituído pelo [roteiro atual](roadmap.md).** Não autoriza execução nem comprova que o servidor esteja ativo. Carrosséis foram adiados até a estabilização da base.

# 🎯 Plano de Execução do MVP (Passo a Passo Fatorado)

> **Documento Oficial de Engenharia & Roadmap de Hoje**  
> **Status:** Em Execução  
> **Servidor Local Ativo:** `http://localhost:5173/` (com Hot Reload / HMR ativo)

---

## 🧭 O Core Loop do Produto
1. **Trigger:** Final do expediente do desenvolvedor.
2. **Ingestão:** Leitura dos commits do dia com filtro anti-ruído (ignora lockfiles e dist).
3. **Síntese (Gemini 2.0 Flash):** Estrutura o post em Gancho (Hook), Desafio Técnico, Aprendizado e CTA.
4. **Estúdio de Curadoria:** Editor com preview em tempo real + **Gerador de Carrossel Visual em Slides**.
5. **Distribuição:** Publicação direta no LinkedIn ou cópia rápida formatada com 1 clique.

---

## 📋 As 4 Etapas Fatoradas para Hoje

### ✅ Etapa 0: Organização do Workspace & Infraestrutura
- [x] Remover pasta duplicada antiga.
- [x] Renomear pasta principal para `automacao-linkedin` (padrão limpo sem espaços).
- [x] Inicializar servidor de desenvolvimento Vite (`http://localhost:5173/`) com Hot Reload (HMR) e abrir no navegador do usuário.

### ⏳ Etapa 1: Estúdio de Carrossel Visual em Slides (LinkedIn Carousel)
- [ ] Criar o componente `CarouselSlidePreview.tsx` em `src/components/carousel-slide-preview.tsx` usando Tailwind v4.
- [ ] Implementar os 4 slides automáticos a partir do rascunho:
  - Slide 1: Capa com título impactante e badge do projeto.
  - Slide 2: O Desafio Enfrentado (Contexto).
  - Slide 3: A Solução de Código (Syntax Card escuro com tipografia mono).
  - Slide 4: Conclusão & Pergunta para networking.
- [ ] Adicionar suporte a alternar entre tema Dark (Dev) e Light (Clean).
- [ ] Integrar na página de rascunho (`src/routes/rascunho.$id.tsx`).

### ⏳ Etapa 2: Exportação do Carrossel para PDF / Imagens
- [ ] Implementar botão de download instantâneo para postar como documento PDF no LinkedIn.

### ⏳ Etapa 3: Botão de Cópia Rápida com Toast & Fallback
- [ ] Garantir que o usuário consiga copiar o post completo em Markdown formatado para o clipboard com 1 clique, mesmo se ainda não conectou o token do LinkedIn.

### ⏳ Etapa 4: Validação de Ponta a Ponta
- [ ] Testar fluxo completo na tela do navegador aberta em `http://localhost:5173/`.
