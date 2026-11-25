/**
 * @file qa-exploratorio.spec.ts
 * @description Suíte de QA Exploratório e Testes de Borda na Interface (Playwright):
 * - Proteção de todas as rotas privadas (/coletas, /fontes, /configuracoes, /publicacoes, /rascunho/:id)
 * - Validações de formulário e limites de caracteres na Home e na tela de revisão
 * - Importação de arquivo (.md / .txt) para anotações do dia
 * - Fluxos de Salvar Alterações e Rejeitar Rascunho
 * - Retorno OAuth do GitHub com erro/parâmetros ausentes (/oauth/github/return)
 * - Desconexão do GitHub em /fontes e tentativa de coleta sem conta conectada
 * - Estado de LinkedIn desconectado em /publicacoes (usuário Bruno)
 * - Página 404, responsividade mobile (375x667) sem overflow horizontal e zero pageerror
 */

import { expect, test, type Page } from "@playwright/test";

const MOCK_CONTROL_URL = "http://127.0.0.1:54329/__control";

async function resetarAmbienteSimulado() {
  const res = await fetch(`${MOCK_CONTROL_URL}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.ok).toBe(true);
}

async function autenticarPorEmail(page: Page, email: string, senha: string) {
  if (!page.url().endsWith("/auth")) {
    await page.goto("/auth", { waitUntil: "networkidle" });
  }
  const campoEmail = page.getByLabel("E-mail");
  const campoSenha = page.getByLabel("Senha");
  await campoEmail.fill(email);
  await campoSenha.fill(senha);
  await expect(campoEmail).toHaveValue(email);
  await expect(campoSenha).toHaveValue(senha);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/$/);
}

test.beforeEach(async () => {
  await resetarAmbienteSimulado();
});

test("QA 1: protege todas as rotas privadas redirecionando visitante não autenticado para /auth e exibe 404 em rota inexistente", async ({
  page,
}) => {
  const rotasPrivadas = [
    "/",
    "/coletas",
    "/fontes",
    "/configuracoes",
    "/publicacoes",
    "/rascunho/id-inexistente",
  ];

  for (const rota of rotasPrivadas) {
    await page.goto(rota, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/auth$/);
  }

  // Valida bloqueio amigável de provedores sociais desativados (GitHub) ou com OAuth secret ausente (Google)
  await page.getByRole("button", { name: "GitHub" }).click();
  await expect(
    page.getByText(/O login social com GitHub não está ativado no Supabase Auth/i),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/auth$/);

  await page.getByRole("button", { name: "Google" }).click();
  await expect(
    page.getByText(/O login social com Google não está ativado no painel do Supabase Auth/i),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/auth$/);

  // Valida página 404 customizada em português
  await page.goto("/rota-inexistente-qa-404", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(page.getByText("Página não encontrada")).toBeVisible();
  await expect(page.getByRole("link", { name: "Voltar ao início" })).toBeVisible();
});

test("QA 2: valida limites de formulário na Home, importa arquivo .md e exercita salvar/rejeitar/limites no rascunho", async ({
  page,
}) => {
  const errosDePagina: string[] = [];
  page.on("pageerror", (err) => errosDePagina.push(err.message));

  await autenticarPorEmail(page, "ana@exemplo.com", "senha-segura-ana");

  // 1. Tenta gerar rascunho com texto curto demais (< 15 caracteres)
  await page.getByLabel("Mudanças do dia").fill("curto");
  await page.getByRole("button", { name: "Gerar resumo e rascunho" }).click();
  await expect(page.getByText(/Escreva um pouco mais sobre o que mudou hoje/i)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  // 2. Importa arquivo .md usando o input file
  await page.locator("input#import").setInputFiles({
    name: "notas-qa.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "- Implementei bateria de testes de QA no Playwright\n- Validei limites de formulário e proteção de rotas",
      "utf8",
    ),
  });
  await expect(page.getByText(/Arquivo importado para as anotações do dia/i)).toBeVisible();
  await expect(page.getByLabel("Mudanças do dia")).toHaveValue(/bateria de testes de QA/i);

  // 3. Gera rascunho a partir do texto importado
  await page.getByRole("button", { name: "Gerar resumo e rascunho" }).click();
  await expect(page).toHaveURL(/\/rascunho\/.+$/);

  // 4. Botão "Gerar nova versão" fica desabilitado quando feedback < 5 caracteres
  const botaoRefinar = page.getByRole("button", { name: "Gerar nova versão" });
  await expect(botaoRefinar).toBeDisabled();
  await page.getByLabel("Complementar o que foi feito").fill("abc");
  await expect(botaoRefinar).toBeDisabled();

  // 5. Bloqueia tentativa de aprovar texto vazio ou menor que 20 caracteres
  const campoPost = page.getByLabel("Texto do post");
  await campoPost.fill("Texto curto");
  await page.getByRole("button", { name: "Aprovar este texto" }).click();
  await expect(page.getByText(/O texto do post deve ter pelo menos 20 caracteres/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Publicar agora" })).toBeDisabled();

  // 6. Salva alterações válidas mantendo status de rascunho
  await campoPost.fill(
    "Texto revisado pelo QA com tamanho válido para testar salvamento intermediário antes da decisão final.",
  );
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText(/Alterações salvas/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Publicar agora" })).toBeDisabled();

  // 7. Rejeita o rascunho, valida abertura do fluxo de adaptação (Re-rascunho) e gera novo re-rascunho adaptado
  await page.getByRole("button", { name: "Rejeitar" }).click();
  await expect(page.getByText(/Rascunho rejeitado/i)).toBeVisible();
  await expect(page.getByText("Rejeitado", { exact: true })).toBeVisible();
  await expect(page.getByText("Como podemos adaptar este rascunho? (Re-rascunho)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publicar agora" })).toBeDisabled();

  await page
    .getByLabel("Complementar o que foi feito")
    .fill("Foque em tópicos diretos sobre segurança OAuth e integridade de dados.");
  await page.getByRole("button", { name: "Fazer re-rascunho com base nisso" }).click();
  await expect(campoPost).toHaveValue(/Re-rascunho adaptado conforme sua direção/i);
  await expect(page.getByText("Aguardando sua revisão", { exact: true })).toBeVisible();

  // 8. Volta ao menu principal e busca commits novamente para receber outro rascunho diferente
  await page.getByRole("link", { name: "Diário → LinkedIn" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Buscar meus commits agora" }).click();
  await expect(page).toHaveURL(/\/rascunho\/.+$/);
  await expect(page.getByLabel("Texto do post")).toHaveValue(
    /Bastidores de segurança e integridade/i,
  );

  expect(errosDePagina).toEqual([]);
});

test("QA 3: trata erros de retorno OAuth do GitHub, desconexão em /fontes e bloqueio de LinkedIn desconectado", async ({
  page,
}) => {
  await autenticarPorEmail(page, "ana@exemplo.com", "senha-segura-ana");

  // 1. Retorno OAuth do GitHub sem parâmetros e com erro explícito
  await page.goto("/oauth/github/return", { waitUntil: "networkidle" });
  await expect(page.getByText("Algo deu errado")).toBeVisible();
  await expect(page.getByText(/Parâmetros de autorização do GitHub incompletos/i)).toBeVisible();

  await page.goto("/oauth/github/return?error=Acesso+negado+pelo+usuario", {
    waitUntil: "networkidle",
  });
  await expect(page.getByText("Algo deu errado")).toBeVisible();
  await expect(page.getByText(/Acesso negado pelo usuario/i)).toBeVisible();
  await page.getByRole("link", { name: "Voltar para Fontes" }).click();
  await expect(page).toHaveURL(/\/fontes$/);

  // 2. Desconecta GitHub em /fontes e tenta coletar commits na Home sem GitHub conectado
  await expect(page.getByText("ana-dev")).toBeVisible();
  await page.getByRole("button", { name: "Desconectar" }).click();
  await expect(page.getByText("GitHub desconectado.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Conectar com o GitHub" })).toBeVisible();

  await page.getByRole("link", { name: /Voltar ao diário/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "Buscar meus commits agora" }).click();
  await expect(
    page.getByText(/GitHub não conectado\. Vá em Fontes para autorizar/i).first(),
  ).toBeVisible();

  // 3. Troca para Bruno (que não possui LinkedIn conectado) e verifica aviso em /publicacoes
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/auth$/);
  await autenticarPorEmail(page, "bruno@exemplo.com", "senha-segura-bruno");

  await page.getByRole("link", { name: "Publicações" }).click();
  await expect(page).toHaveURL(/\/publicacoes$/);
  await expect(
    page.getByText(/Nenhuma conta autorizada\. Enquanto isso, a publicação fica bloqueada/i),
  ).toBeVisible();
});

test("QA 4: valida responsividade mobile (375x667) sem overflow horizontal nas telas principais", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await autenticarPorEmail(page, "ana@exemplo.com", "senha-segura-ana");

  const rotasParaInspecionar = ["/", "/fontes", "/configuracoes", "/coletas", "/publicacoes"];
  for (const rota of rotasParaInspecionar) {
    await page.goto(rota, { waitUntil: "networkidle" });
    const semOverflowHorizontal = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(semOverflowHorizontal, `Overflow horizontal detectado em ${rota}`).toBe(true);
  }
});
