/**
 * Cotacao USD -> BRL para exibir os gastos de IA em reais.
 *
 * A cotacao vem da tabela `exchange_rate` (linha unica), atualizada por um
 * fluxo do n8n. Como o painel depende de um processo externo, esta funcao nao
 * confia cegamente no valor gravado:
 *
 *  - fora da faixa plausivel: NAO converte. Um valor abaixo de 1 e quase
 *    certamente a cotacao invertida (BRL -> USD, ~0,19), o que mostraria os
 *    gastos cinco vezes menores do que sao.
 *  - velha demais: converte, mas o painel avisa — costuma ser o fluxo parado.
 *
 * Modulo puro (sem Supabase, sem Next), testavel isoladamente.
 */

/** Faixa plausivel do real frente ao dolar. Fora dela, o valor e tratado como erro. */
export const FX_MIN_BRL = 1
export const FX_MAX_BRL = 20

/**
 * Acima disso a cotacao e considerada velha. Folga para fim de semana e
 * feriado: cotacoes oficiais (PTAX) nao sao publicadas nesses dias.
 */
export const FX_STALE_HOURS = 96

export type FxStatus = 'ok' | 'stale' | 'invalid' | 'missing'

export interface FxInfo {
  status: FxStatus
  /** Cotacao usada na conversao; null quando nao da para converter. */
  rate: number | null
  /** Valor gravado na tabela, mesmo quando invalido (para o aviso). */
  rawRate: number | null
  updatedAt: string | null
  ageHours: number | null
  /** Valor entre 0 e 1: provavelmente gravado invertido. */
  looksInverted: boolean
}

export function evaluateFx(
  row: { usd_to_brl: number | string | null; updated_at: string | null } | null,
  now: Date = new Date()
): FxInfo {
  if (!row || row.usd_to_brl === null || row.usd_to_brl === undefined) {
    return { status: 'missing', rate: null, rawRate: null, updatedAt: null, ageHours: null, looksInverted: false }
  }

  // numeric chega do PostgREST como numero ou string, dependendo da precisao.
  const raw = Number(row.usd_to_brl)
  const updatedAt = row.updated_at
  const updatedMs = updatedAt ? new Date(updatedAt).getTime() : NaN
  const ageHours = Number.isFinite(updatedMs) ? (now.getTime() - updatedMs) / 3_600_000 : null

  if (!Number.isFinite(raw) || raw < FX_MIN_BRL || raw > FX_MAX_BRL) {
    return {
      status: 'invalid',
      rate: null,
      rawRate: Number.isFinite(raw) ? raw : null,
      updatedAt,
      ageHours,
      looksInverted: Number.isFinite(raw) && raw > 0 && raw < 1,
    }
  }

  const stale = ageHours === null || ageHours > FX_STALE_HOURS
  return {
    status: stale ? 'stale' : 'ok',
    rate: raw,
    rawRate: raw,
    updatedAt,
    ageHours,
    looksInverted: false,
  }
}
