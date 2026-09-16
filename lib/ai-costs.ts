import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'
import { DAY_MS, resolvePeriod, type PeriodKey, type ResolvedPeriod } from '@/lib/ai-costs-period'

export { PERIODS, parsePeriod, type PeriodKey } from '@/lib/ai-costs-period'

/**
 * Gastos com IA por agente — leitura para o dashboard.
 *
 * Os dados vem do workflow "Coleta de Tokens" do n8n, gravados em
 * `token_usage_log` (migration 011). Toda agregacao acontece no banco via
 * `token_cost_por_agente` e `token_cost_diario`: somar linhas aqui esbarraria
 * no limite de 1000 linhas do PostgREST e mostraria totais MENORES que os reais,
 * sem nenhum erro.
 *
 * Valores em US$ estimados a partir de `model_pricing`. Dias no fuso de
 * Brasilia (UTC-3, sem horario de verao desde 2019).
 */

type AgentRpcRow = Database['public']['Functions']['token_cost_por_agente']['Returns'][number]
type DailyRpcRow = Database['public']['Functions']['token_cost_diario']['Returns'][number]

// ─────────────────────────────────────────────────────────────────────────────
// Resultado
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentCost {
  name: string
  cost: number
  prevCost: number
  /** null quando nao ha base de comparacao (periodo anterior sem gasto). */
  deltaPct: number | null
  share: number
  tokens: number
  calls: number
  executions: number
  conversations: number
  costPerExecution: number | null
  models: string[]
  missingPriceModels: string[]
  missingPriceTokens: number
  lastRun: string | null
  /** Gastou no periodo anterior e nada agora: agente pode ter parado. */
  wentSilent: boolean
}

export interface DailySegment {
  series: string
  cost: number
}

export interface DailyBar {
  day: string
  total: number
  segments: DailySegment[]
}

export type CostsResult =
  | { state: 'not_installed'; detail: string }
  | { state: 'error'; detail: string }
  | {
      state: 'ok'
      period: ResolvedPeriod
      total: number
      prevTotal: number
      deltaPct: number | null
      tokens: number
      executions: number
      projection: number | null
      agents: AgentCost[]
      /** Nomes das series do grafico, na ordem das cores. */
      series: string[]
      daily: DailyBar[]
      missingPrice: { models: string[]; tokens: number }
      lastCollection: string | null
    }

/** Maximo de series coloridas: acima disso, o resto vira "Outros". */
const MAX_SERIES = 5
export const OTHERS_SERIES = 'Outros'

function isNotInstalled(error: { code?: string; message: string }): boolean {
  return (
    error.code === 'PGRST202' ||  // funcao nao encontrada no schema cache
    error.code === '42883'    ||  // undefined_function
    error.code === '42P01'    ||  // undefined_table
    /Could not find the function|does not exist/i.test(error.message)
  )
}

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

export async function loadAiCosts(key: PeriodKey): Promise<CostsResult> {
  const period   = resolvePeriod(key)
  const supabase = await createClient()

  const range = (desde: Date, ate: Date) => ({ p_desde: desde.toISOString(), p_ate: ate.toISOString() })

  const [current, previous, daily] = await Promise.all([
    supabase.rpc('token_cost_por_agente', range(period.desde, period.ate)),
    supabase.rpc('token_cost_por_agente', range(period.prevDesde, period.prevAte)),
    supabase.rpc('token_cost_diario',     range(period.desde, period.ate)),
  ])

  const firstError = current.error ?? previous.error ?? daily.error
  if (firstError) {
    if (isNotInstalled(firstError)) {
      return { state: 'not_installed', detail: firstError.message }
    }
    console.error('[ai-costs] falha ao consultar gastos:', firstError.message)
    return { state: 'error', detail: firstError.message }
  }

  const currentRows: AgentRpcRow[] = current.data ?? []
  const previousRows: AgentRpcRow[] = previous.data ?? []
  const dailyRows: DailyRpcRow[] = daily.data ?? []

  const total     = currentRows.reduce((s, r) => s + Number(r.custo_usd), 0)
  const prevTotal = previousRows.reduce((s, r) => s + Number(r.custo_usd), 0)
  const prevByName = new Map(previousRows.map((r) => [r.workflow_name, Number(r.custo_usd)]))

  const agents: AgentCost[] = currentRows.map((r) => {
    const cost       = Number(r.custo_usd)
    const prevCost   = prevByName.get(r.workflow_name) ?? 0
    const executions = Number(r.execucoes)
    return {
      name: r.workflow_name,
      cost,
      prevCost,
      deltaPct: pctChange(cost, prevCost),
      share: total > 0 ? cost / total : 0,
      tokens: Number(r.total_tokens),
      calls: Number(r.chamadas),
      executions,
      conversations: Number(r.conversas),
      costPerExecution: executions > 0 ? cost / executions : null,
      models: r.modelos ?? [],
      missingPriceModels: r.modelos_sem_preco ?? [],
      missingPriceTokens: Number(r.tokens_sem_preco),
      lastRun: r.ultima_execucao,
      wentSilent: false,
    }
  })

  // Agentes que custavam no periodo anterior e sumiram: aparecem no fim da
  // tabela. Queda para zero tende a ser agente quebrado, nao economia.
  const currentNames = new Set(agents.map((a) => a.name))
  for (const r of previousRows) {
    if (currentNames.has(r.workflow_name) || Number(r.custo_usd) <= 0) continue
    agents.push({
      name: r.workflow_name,
      cost: 0,
      prevCost: Number(r.custo_usd),
      deltaPct: -100,
      share: 0,
      tokens: 0,
      calls: 0,
      executions: 0,
      conversations: 0,
      costPerExecution: null,
      models: r.modelos ?? [],
      missingPriceModels: [],
      missingPriceTokens: 0,
      lastRun: r.ultima_execucao,
      wentSilent: true,
    })
  }

  // ── Series do grafico ───────────────────────────────────────────────────
  const ranked = agents.filter((a) => a.cost > 0).map((a) => a.name)
  const grouped = ranked.length > MAX_SERIES
  const named = grouped ? ranked.slice(0, MAX_SERIES - 1) : ranked
  const series = grouped ? [...named, OTHERS_SERIES] : named
  const seriesOf = (name: string) => (named.includes(name) ? name : OTHERS_SERIES)

  const byDay = new Map<string, Map<string, number>>()
  for (const row of dailyRows) {
    const bucket = byDay.get(row.dia) ?? new Map<string, number>()
    const s = seriesOf(row.workflow_name)
    bucket.set(s, (bucket.get(s) ?? 0) + Number(row.custo_usd))
    byDay.set(row.dia, bucket)
  }

  const dailyBars: DailyBar[] = period.days.map((day) => {
    const bucket = byDay.get(day)
    const segments = series
      .map((s) => ({ series: s, cost: bucket?.get(s) ?? 0 }))
      .filter((seg) => seg.cost > 0)
    return { day, total: segments.reduce((sum, seg) => sum + seg.cost, 0), segments }
  })

  // ── Pendencias de preco ─────────────────────────────────────────────────
  const missingModels = new Set<string>()
  let missingTokens = 0
  for (const a of agents) {
    a.missingPriceModels.forEach((m) => missingModels.add(m))
    missingTokens += a.missingPriceTokens
  }

  // ── Projecao do mes ─────────────────────────────────────────────────────
  // So a partir de 3 dias: antes disso um unico dia atipico distorce tudo.
  const mp = period.monthProgress
  const projection =
    mp && mp.elapsedMs >= 3 * DAY_MS && total > 0
      ? total * (mp.totalMs / mp.elapsedMs)
      : null

  const lastCollection = agents
    .map((a) => a.lastRun)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1) ?? null

  return {
    state: 'ok',
    period,
    total,
    prevTotal,
    deltaPct: pctChange(total, prevTotal),
    tokens: agents.reduce((s, a) => s + a.tokens, 0),
    executions: agents.reduce((s, a) => s + a.executions, 0),
    projection,
    agents,
    series,
    daily: dailyBars,
    missingPrice: { models: [...missingModels].sort(), tokens: missingTokens },
    lastCollection,
  }
}
