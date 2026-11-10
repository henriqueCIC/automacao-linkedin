export const COLLECTION_STEPS = [
  { status: "autenticando", label: "Login na conta GitHub" },
  { status: "repositorios", label: "Encontrar repositórios" },
  { status: "commits", label: "Buscar commits novos" },
  { status: "diffs", label: "Ler git diff do período" },
  { status: "gerando", label: "Gerar resumo e rascunho" },
  { status: "salvando", label: "Salvar para sua revisão" },
] as const;

export function isCollectionRunning(status: string) {
  return COLLECTION_STEPS.some((step) => step.status === status);
}