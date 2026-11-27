/**
 * @file timezone.ts
 * @description Utilitários puros e determinísticos para validação de fusos horários IANA,
 * normalização de valores legados e cálculo de janelas de agendamento (A02).
 */

export const FUSO_HORARIO_PADRAO = "America/Bahia";

/** Lista oficial de fusos horários IANA válidos exibidos na tela de configurações */
export const FUSOS_HORARIOS_SUPORTADOS = [
  "America/Bahia",
  "America/Sao_Paulo",
  "America/Fortaleza",
  "America/Recife",
  "America/Belem",
  "America/Cuiaba",
  "America/Manaus",
  "UTC",
] as const;

/** Mapa de migração transparente para fusos não-IANA gravados em versões anteriores */
const ALIAS_FUSOS_LEGADOS: Readonly<Record<string, string>> = {
  "America/Rio_de_Janeiro": "America/Sao_Paulo",
};

/**
 * Verifica se uma string representa um identificador de fuso horário IANA válido no runtime JS.
 */
export function ehFusoHorarioValido(fusoHorario: string): boolean {
  const limpo = fusoHorario.trim();
  if (!limpo) return false;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: limpo });
    return true;
  } catch {
    return false;
  }
}

/**
 * Converte aliases legados conhecidos e garante retorno de um fuso horário IANA válido.
 */
export function normalizarFusoHorario(fusoHorario?: string | null): string {
  const bruto = fusoHorario?.trim();
  if (!bruto) return FUSO_HORARIO_PADRAO;

  const mapeado = ALIAS_FUSOS_LEGADOS[bruto] ?? bruto;
  if (ehFusoHorarioValido(mapeado)) {
    return mapeado;
  }
  return FUSO_HORARIO_PADRAO;
}

/**
 * Extrai a data ('YYYY-MM-DD') e o horário ('HH:mm') determinísticos de um instante no fuso informado.
 */
export function partesDataHoraNoFuso(
  fusoHorario: string,
  agora: Date = new Date(),
): { data: string; hora: string; fusoAplicado: string } {
  const fusoAplicado = normalizarFusoHorario(fusoHorario);
  const formatador = new Intl.DateTimeFormat("en-GB", {
    timeZone: fusoAplicado,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const partes = formatador.formatToParts(agora);
  const obter = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? "";
  // Algumas implementações de Intl podem retornar "24" à meia-noite em en-GB
  const horaBruta = obter("hour");
  const horaNormalizada = horaBruta === "24" ? "00" : horaBruta;

  return {
    data: `${obter("year")}-${obter("month")}-${obter("day")}`,
    hora: `${horaNormalizada}:${obter("minute")}`,
    fusoAplicado,
  };
}

/**
 * Calcula a janela inicial padrão de 24 horas atrás em formato ISO UTC determinístico.
 */
export function calcularJanela24HorasAtras(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Avalia se a coleta diária agendada deve executar no instante `agora`.
 */
export function deveExecutarColetaAgendada(parametros: {
  horarioDiario: string;
  fusoHorario: string;
  ultimaDataSucesso: string | null;
  agora?: Date;
}): boolean {
  const { data, hora } = partesDataHoraNoFuso(parametros.fusoHorario, parametros.agora);
  if (parametros.ultimaDataSucesso === data) {
    return false;
  }
  const alvo = parametros.horarioDiario.trim().slice(0, 5);
  if (!/^\d{2}:\d{2}$/.test(alvo)) {
    return false;
  }
  return hora >= alvo;
}
