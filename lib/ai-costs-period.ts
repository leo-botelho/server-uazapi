/**
 * Periodos do acompanhamento de gastos, no calendario de Brasilia.
 *
 * Modulo puro (sem Supabase, sem Next): usado pelo carregador no servidor e
 * pelos filtros da UI, e testavel isoladamente.
 *
 * Brasilia e UTC-3 fixo desde o fim do horario de verao, em 2019.
 */

export type PeriodKey = '7d' | '30d' | 'mes'

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'mes', label: 'Mês atual' },
  { key: '7d',  label: '7 dias' },
  { key: '30d', label: '30 dias' },
]

export function parsePeriod(value: string | string[] | undefined): PeriodKey {
  const v = Array.isArray(value) ? value[0] : value
  return v === '7d' || v === '30d' || v === 'mes' ? v : 'mes'
}

// ─────────────────────────────────────────────────────────────────────────────
// Periodos em horario de Brasilia
// ─────────────────────────────────────────────────────────────────────────────

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000

/** 00:00 de Brasilia do dia informado. Date.UTC normaliza dias fora do mes. */
function brtMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) + BRT_OFFSET_MS)
}

/** Ano/mes/dia do calendario de Brasilia para um instante. */
function brtParts(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() - BRT_OFFSET_MS)
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() }
}

/** Chave yyyy-mm-dd do dia de Brasilia — mesmo formato que o banco devolve. */
function brtDayKey(date: Date): string {
  const { year, month, day } = brtParts(date)
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export interface ResolvedPeriod {
  key: PeriodKey
  label: string
  desde: Date
  ate: Date
  /** Intervalo de mesma duracao usado na comparacao. */
  prevDesde: Date
  prevAte: Date
  /** Rotulos do periodo de comparacao, cada um para uma construcao da frase. */
  prev: {
    /** "vs {short}" — cabe no card: "mês anterior" */
    short: string
    /** "comparado com {com}" — "o mesmo período do mês anterior" */
    com: string
    /** "teve gasto {em}" — "no mesmo período do mês anterior" */
    em: string
  }
  /** Dias do grafico, do primeiro ao de hoje. */
  days: string[]
  /** Apenas no mes atual: fracao do mes ja decorrida, para a projecao. */
  monthProgress: { elapsedMs: number; totalMs: number } | null
}

export function resolvePeriod(key: PeriodKey, now: Date = new Date()): ResolvedPeriod {
  const { year, month, day } = brtParts(now)
  const label = PERIODS.find((p) => p.key === key)?.label ?? key

  let desde: Date
  let prevDesde: Date
  let prevAte: Date
  let prev: ResolvedPeriod['prev']
  let monthProgress: ResolvedPeriod['monthProgress'] = null

  if (key === 'mes') {
    desde = brtMidnight(year, month, 1)
    const elapsed = now.getTime() - desde.getTime()
    // Mesmo trecho do mes anterior (do dia 1 ate o mesmo ponto), para que a
    // comparacao nao ponha um mes parcial contra um mes cheio.
    prevDesde = brtMidnight(year, month - 1, 1)
    prevAte   = new Date(Math.min(prevDesde.getTime() + elapsed, desde.getTime()))
    prev = {
      short: 'mês anterior',
      com:   'o mesmo período do mês anterior',
      em:    'no mesmo período do mês anterior',
    }
    monthProgress = {
      elapsedMs: elapsed,
      totalMs: brtMidnight(year, month + 1, 1).getTime() - desde.getTime(),
    }
  } else {
    const span = key === '7d' ? 7 : 30
    desde = brtMidnight(year, month, day - (span - 1))
    const duration = now.getTime() - desde.getTime()
    prevAte   = desde
    prevDesde = new Date(desde.getTime() - duration)
    prev = {
      short: `${span} dias anteriores`,
      com:   `os ${span} dias anteriores`,
      em:    `nos ${span} dias anteriores`,
    }
  }

  const days: string[] = []
  for (let t = desde.getTime(); t <= now.getTime(); t += DAY_MS) {
    days.push(brtDayKey(new Date(t)))
  }

  return { key, label, desde, ate: now, prevDesde, prevAte, prev, days, monthProgress }
}
