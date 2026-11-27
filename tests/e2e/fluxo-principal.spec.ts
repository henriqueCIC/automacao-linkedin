/**
 * @file fluxo-principal.spec.ts
 * @description Suíte E2E com Playwright cobrindo autenticação, coleta simulada do GitHub,
 * criação/edição/refinamento de rascunho, aprovação humana obrigatória, publicação simulada
 * no LinkedIn (sem conta real), tratamento de falhas e isolamento na troca de usuário (Etapa 4).
 */

import { expect, test, type Page } from "@playwright/test";

const MOCK_CONTROL_URL = "http://127.0.0.1:54329/__control";

async function resetarAmbienteSimulado(opcoes: { failNextGemini?: boolean } = {}) {
  const res = await fetch(`${MOCK_CONTROL_URL}/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opcoes),
  });
  expect(res.ok).toBe(true);
}

async function configurarAmbienteSimulado(opcoes: { failNextGemini?: boolean }) {
  const res = await fetch(`${MOCK_CONTROL_URL}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opcoes),
  });
  expect(res.ok).toBe(true);
}

async function lerEstadoSimulado(): Promise<{
  publishedLinkedInPosts: Array<{ id: string; payload: unknown }>;
  draftsCount: number;
  seenCommitsCount: number;
}> {
  const res = await fetch(`${MOCK_CONTROL_URL}/state`);
  return (await res.json()) as {
    publishedLinkedInPosts: Array<{ id: string; payload: unknown }>;
    draftsCount: number;
    seenCommitsCount: number;
  };
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

test("redireciona visitante não autenticado para /auth, exibe erro em credencial inválida e entra com sucesso", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/auth$/);

  await page.getByLabel("E-mail").fill("ana@exemplo.com");
  await page.getByLabel("Senha").fill("senha-incorreta");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByText(/E-mail ou senha inválidos/i)).toBeVisible();
  await expect(page).toHaveURL(/\/auth$/);

  await page.getByLabel("Senha").fill("senha-segura-ana");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Ana Silva")).toBeVisible();
  await expect(page.getByText("O que mudou hoje?")).toBeVisible();
});

test("executa coleta do GitHub, exige aprovação humana após edição e publica apenas no LinkedIn simulado", async ({
  page,
}) => {
  await autenticarPorEmail(page, "ana@exemplo.com", "senha-segura-ana");
  await expect(page.getByRole("button", { name: "Buscar meus commits agora" })).toBeVisible();

  await page.getByRole("button", { name: "Buscar meus commits agora" }).click();

  // Deve redirecionar automaticamente para a tela de revisão do rascunho gerado
  await expect(page).toHaveURL(/\/rascunho\/.+$/);
  await expect(page.getByText("Resumo do dia")).toBeVisible();

  // Regra de ouro: botão "Publicar agora" inicia DESABILITADO até aprovação humana explícita
  const botaoPublicar = page.getByRole("button", { name: "Publicar agora" });
  await expect(botaoPublicar).toBeDisabled();
  await expect(page.getByText("Aprove o texto acima para liberar a publicação.")).toBeVisible();

  // Edição do conteúdo pelo humano
  const campoPost = page.getByLabel("Texto do post");
  await expect(campoPost).toHaveValue(/Zod/i);
  await campoPost.fill(
    "Post revisado por Ana: validação com Zod, filtro seguro e aprovação humana preservada no fluxo completo! #TypeScript #Qualidade",
  );

  await expect(
    page.getByText("Você editou o texto: salve e aprove novamente para liberar a publicação."),
  ).toBeVisible();
  await expect(botaoPublicar).toBeDisabled();

  // Aprovação explícita pela usuária
  await page.getByRole("button", { name: "Aprovar este texto" }).click();
  await expect(botaoPublicar).toBeEnabled();

  // Confirmação final no modal acessível antes de enviar ao LinkedIn simulado
  await botaoPublicar.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByText("Publicar este texto no LinkedIn?")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar publicação" }).click();

  await expect(page.getByText("Publicado no LinkedIn", { exact: true })).toBeVisible();

  // Confere histórico de publicações e consulta status no LinkedIn simulado
  await page.getByRole("link", { name: "Publicações" }).click();
  await expect(page).toHaveURL(/\/publicacoes$/);
  await page.getByRole("button", { name: "Conferir status" }).click();
  await expect(page.getByText(/Publicado e visível/i)).toBeVisible();

  // Comprova no mock que exatamente 1 publicação simulada ocorreu e seen_commits foi confirmado
  const estado = await lerEstadoSimulado();
  expect(estado.publishedLinkedInPosts).toHaveLength(1);
  expect(estado.seenCommitsCount).toBe(1);
});

test("gera rascunho manual, refina com feedback e trata falha simulada da IA com feedback claro", async ({
  page,
}) => {
  await autenticarPorEmail(page, "ana@exemplo.com", "senha-segura-ana");

  await page
    .getByLabel("Mudanças do dia")
    .fill("- Estruturei os testes E2E com Playwright\n- Criei servidor simulado sem efeitos reais");
  await page.getByRole("button", { name: "Gerar resumo e rascunho" }).click();

  await expect(page).toHaveURL(/\/rascunho\/.+$/);
  const campoPost = page.getByLabel("Texto do post");
  await expect(campoPost).toHaveValue(/automação/i);

  // Refinamento com complemento humano
  await page
    .getByLabel("Complementar o que foi feito")
    .fill("Destaque que o trabalho foi concluído em equipe.");
  await page.getByRole("button", { name: "Gerar nova versão" }).click();
  await expect(campoPost).toHaveValue(/em equipe/i);

  // Simula falha na IA ao pedir novo refinamento e verifica resiliência da interface
  await configurarAmbienteSimulado({ failNextGemini: true });
  await page
    .getByLabel("Complementar o que foi feito")
    .fill("Tente gerar novamente durante indisponibilidade.");
  await page.getByRole("button", { name: "Gerar nova versão" }).click();

  await expect(page.getByText(/Falha na API do Gemini/i)).toBeVisible();
  // O texto anterior permanece íntegro na tela
  await expect(campoPost).toHaveValue(/em equipe/i);
});

test("navega pelas seções, alterna tema e preserva isolamento total de dados na troca de usuário", async ({
  page,
}) => {
  await autenticarPorEmail(page, "ana@exemplo.com", "senha-segura-ana");

  await page
    .getByLabel("Mudanças do dia")
    .fill("- Registro exclusivo da usuária Ana para validar isolamento entre sessões");
  await page.getByRole("button", { name: "Gerar resumo e rascunho" }).click();
  await expect(page).toHaveURL(/\/rascunho\/.+$/);

  // Navega pelas rotas principais da aplicação e valida alternância de tema
  await page.getByRole("link", { name: "Diário → LinkedIn" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(/Implementada validação de schemas Zod/i)).toBeVisible();

  await page.getByRole("button", { name: "Ativar modo claro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "Ativar modo noturno" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await page.getByRole("link", { name: "Coletas" }).click();
  await expect(page).toHaveURL(/\/coletas$/);
  await expect(page.getByRole("heading", { name: "Coletas" })).toBeVisible();
  await page.getByRole("link", { name: /Voltar ao diário/i }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("link", { name: "Fontes" }).click();
  await expect(page).toHaveURL(/\/fontes$/);
  await expect(page.getByText("ana-dev")).toBeVisible();
  await page.getByRole("link", { name: /Voltar ao diário/i }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("link", { name: "Configurações" }).click();
  await expect(page).toHaveURL(/\/configuracoes$/);
  await expect(page.getByText("Configurações", { exact: true })).toBeVisible();
  await page.getByLabel("Limite de commits por dia").fill("25");
  await page.getByRole("button", { name: "Salvar configurações" }).click();
  await expect(page.getByText(/As configurações foram atualizadas/i)).toBeVisible();

  await page.getByRole("link", { name: /Voltar ao diário/i }).click();
  await expect(page).toHaveURL(/\/$/);

  // Encerra sessão de Ana e entra como Bruno
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/auth$/);

  await autenticarPorEmail(page, "bruno@exemplo.com", "senha-segura-bruno");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Bruno Costa")).toBeVisible();

  // Bruno não pode visualizar rascunhos nem registros pertencentes a Ana
  await expect(page.getByText("Nenhum rascunho ainda. Registre o seu dia ao lado.")).toBeVisible();
  await expect(page.getByText(/Implementada validação de schemas Zod/i)).toHaveCount(0);
});
