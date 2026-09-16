import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BotOff, Database, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { loadAiCosts, OTHERS_SERIES, PERIODS, type AgentCost, type CostsResult, type PeriodKey } from '@/lib/ai-costs'

/**
 * Acompanhamento de gastos com IA por agente, no dashboard.
 *
 * Server Component sem JavaScript no cliente: o filtro de periodo e um link
 * (`?gastos=`), entao a URL pode ser compartilhada e funciona sem hidratar.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Formatacao
// ─────────────────────────────────────────────────────────────────────────────

const usdFull  = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const usdFour  = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 4 })
const compact  = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
const integer  = new Intl.NumberFormat('pt-BR')
const pct0     = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

/**
 * Totais com 2 casas. Abaixo de 1 centavo, 4 casas: gasto real nao pode
 * aparecer como US$ 0,00.
 */
function usd(value: number): string {
  return value > 0 && value < 0.01 ? usdFour.format(value) : usdFull.format(value)
}

/** Custo unitario (por execucao) e sempre fracao de centavo: 4 casas fixas alinham a coluna. */
function usdUnit(value: number): string {
  return usdFour.format(value)
}

function shortDay(key: string): string {
  const [, m, d] = key.split('-')
  return `${d}/${m}`
}

function dateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** Cores do tema; "Outros" sempre no cinza, para nao parecer mais um agente. */
function seriesColor(series: string[], name: string): string {
  if (name === OTHERS_SERIES) return 'var(--chart-5)'
  const i = series.indexOf(name)
  return `var(--chart-${(i % 5) + 1})`
}

// ─────────────────────────────────────────────────────────────────────────────
// Pecas
// ─────────────────────────────────────────────────────────────────────────────

function Delta({ value, label }: { value: number | null; label?: string }) {
  if (value === null) {
    return <span className="text-muted-foreground">{label ? 'sem base de comparação' : '—'}</span>
  }
  const Icon = value > 0.5 ? ArrowUpRight : value < -0.5 ? ArrowDownRight : Minus
  return (
    <span className="inline-flex items-center gap-0.5 text-foreground">
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span>
        {value > 0 ? '+' : ''}{pct0.format(value)}%
        {label && <span className="text-muted-foreground"> vs {label}</span>}
      </span>
    </span>
  )
}

function Kpi({ title, value, detail }: { title: string; value: string; detail: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      <div className="mt-1 text-xs">{detail}</div>
    </div>
  )
}

function PeriodFilter({ active }: { active: PeriodKey }) {
  return (
    <nav aria-label="Período dos gastos" className="inline-flex rounded-lg border bg-card p-0.5">
      {PERIODS.map((p) => (
        <Link
          key={p.key}
          href={`?gastos=${p.key}`}
          scroll={false}
          aria-current={p.key === active ? 'page' : undefined}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm transition-colors',
            p.key === active
              ? 'bg-primary text-primary-foreground font-medium'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  )
}

function DailyChart({
  daily, series,
}: {
  daily: { day: string; total: number; segments: { series: string; cost: number }[] }[]
  series: string[]
}) {
  const max = Math.max(...daily.map((d) => d.total), 0)
  const total = daily.reduce((s, d) => s + d.total, 0)
  // Rotulos do eixo X: todos ate 10 dias, depois um a cada 5 e sempre o ultimo —
  // omitindo o intermediario que ficaria colado nele.
  const every = daily.length <= 10 ? 1 : 5
  const last = daily.length - 1
  const showLabel = (i: number) => i === last || (i % every === 0 && last - i >= every)
  // Nas pontas o rotulo alinha para dentro, senao vaza da borda do grafico.
  // Usa justify (flex) e nao text-align: texto maior que a coluna transborda
  // sempre para a direita com text-align, mas para o lado inicial com justify-end.
  const labelAlign = (i: number) =>
    every === 1 ? 'justify-center' : i === 0 ? 'justify-start' : i === last ? 'justify-end' : 'justify-center'

  if (max === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nenhum gasto registrado nos dias deste período.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div
        role="img"
        aria-label={`Gasto diário por agente: ${usd(total)} em ${daily.length} dias, pico de ${usd(max)} em um dia.`}
        className="relative"
      >
        {/* Guias de escala */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-44">
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" />
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/60" />
          <span className="absolute right-0 -top-5 text-[11px] tabular-nums text-muted-foreground">{usd(max)}</span>
        </div>

        <div className="flex h-44 items-end gap-[2px] border-b border-border">
          {daily.map((bar) => (
            <div
              key={bar.day}
              className="group flex h-full min-w-0 flex-1 flex-col-reverse"
              title={
                bar.total > 0
                  ? `${shortDay(bar.day)} — ${usd(bar.total)}\n` +
                    bar.segments.map((s) => `${s.series}: ${usd(s.cost)}`).join('\n')
                  : `${shortDay(bar.day)} — sem gasto`
              }
            >
              {bar.segments.map((seg) => (
                <div
                  key={seg.series}
                  className="w-full first:rounded-b-[2px] last:rounded-t-[2px] group-hover:opacity-80"
                  style={{
                    height: `${(seg.cost / max) * 100}%`,
                    backgroundColor: seriesColor(series, seg.series),
                  }}
                />
              ))}
            </div>
          ))}
        </div>

        <div aria-hidden className="mt-1 flex gap-[2px]">
          {daily.map((bar, i) => (
            <span
              key={bar.day}
              className={cn('flex min-w-0 flex-1 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground', labelAlign(i))}
            >
              {showLabel(i) ? shortDay(bar.day) : ''}
            </span>
          ))}
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
        {series.map((name) => (
          <li key={name} className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[2px]" style={{ backgroundColor: seriesColor(series, name) }} />
            <span className="text-foreground">{name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function AgentsTable({ agents, prevCom }: { agents: AgentCost[]; prevCom: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Agente</TableHead>
          <TableHead className="text-right">Gasto</TableHead>
          <TableHead className="min-w-32">Participação</TableHead>
          <TableHead className="text-right" title={`Comparado com ${prevCom}`}>Variação</TableHead>
          <TableHead className="text-right">Execuções</TableHead>
          <TableHead className="text-right">Conversas</TableHead>
          <TableHead className="text-right">Custo / execução</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead>Modelos</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {agents.map((a) => (
          <TableRow key={a.name} className={cn(a.wentSilent && 'bg-amber-500/5')}>
            <TableCell className="font-medium">
              <div className="flex items-center gap-2">
                {a.name}
                {a.wentSilent && (
                  <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-400">
                    <BotOff className="size-3" aria-hidden />
                    sem uso
                  </Badge>
                )}
              </div>
              <div className="text-xs font-normal text-muted-foreground">
                última execução {dateTime(a.lastRun)}
              </div>
            </TableCell>
            <TableCell className="text-right tabular-nums font-medium">{usd(a.cost)}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${a.share * 100}%` }} />
                </div>
                <span className="w-9 text-right text-xs tabular-nums">{pct0.format(a.share * 100)}%</span>
              </div>
            </TableCell>
            <TableCell className="text-right text-xs tabular-nums">
              <span title={`Em ${prevCom}: ${usd(a.prevCost)}`}>
                <Delta value={a.deltaPct} />
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">{integer.format(a.executions)}</TableCell>
            <TableCell className="text-right tabular-nums">{integer.format(a.conversations)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {a.costPerExecution === null ? '—' : usdUnit(a.costPerExecution)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{compact.format(a.tokens)}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {a.models.map((m) => (
                  <Badge
                    key={m}
                    variant="outline"
                    className={cn('font-mono text-[11px]', a.missingPriceModels.includes(m) && 'border-amber-500/50 text-amber-400')}
                    title={a.missingPriceModels.includes(m) ? 'Sem preço cadastrado: contado como US$ 0' : undefined}
                  >
                    {m}
                  </Badge>
                ))}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Secao
// ─────────────────────────────────────────────────────────────────────────────

/** Carrega os gastos e renderiza. Usado no dashboard dentro de <Suspense>. */
export async function AiCostsSection({ period }: { period: PeriodKey }) {
  return <AiCostsView period={period} result={await loadAiCosts(period)} />
}

/** Renderizacao pura a partir do resultado — sem acesso a banco. */
export function AiCostsView({ period, result }: { period: PeriodKey; result: CostsResult }) {

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold">Gastos com IA por agente</h2>
        <p className="text-sm text-muted-foreground">
          Estimativa em US$ a partir dos tokens consumidos pelos agentes no n8n
        </p>
      </div>
      <PeriodFilter active={period} />
    </div>
  )

  if (result.state === 'not_installed') {
    return (
      <section className="space-y-4">
        {header}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="size-5 text-muted-foreground" aria-hidden />
              Rastreamento de tokens ainda não instalado
            </CardTitle>
            <CardDescription>
              As tabelas e funções de consumo não existem neste banco.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                No SQL Editor do Supabase, rode{' '}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">supabase/migrations/011_token_usage.sql</code>.
              </li>
              <li>
                No n8n, aponte <strong>apenas</strong> o nó <strong>Grava Uso</strong> do workflow{' '}
                <strong>Coleta de Tokens</strong> para a connection string deste Supabase. Os nós que
                leem <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">execution_entity</code>{' '}
                continuam no banco do n8n.
              </li>
              <li>Aguarde a próxima rodada do coletor (a cada hora).</li>
            </ol>
          </CardContent>
        </Card>
      </section>
    )
  }

  if (result.state === 'error') {
    return (
      <section className="space-y-4">
        {header}
        <Alert variant="destructive">
          <AlertTriangle aria-hidden />
          <AlertTitle>Não foi possível carregar os gastos</AlertTitle>
          <AlertDescription>{result.detail}</AlertDescription>
        </Alert>
      </section>
    )
  }

  const { period: p, agents } = result
  const activeAgents = agents.filter((a) => !a.wentSilent)
  const silentAgents = agents.filter((a) => a.wentSilent)

  if (agents.length === 0) {
    return (
      <section className="space-y-4">
        {header}
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">Nenhum consumo registrado neste período</p>
            <p className="mt-1 text-sm text-muted-foreground">
              O coletor do n8n roda a cada hora. Se os agentes estão atendendo e nada aparece
              aqui, confira as execuções do workflow <strong>Coleta de Tokens</strong>.
            </p>
          </CardContent>
        </Card>
      </section>
    )
  }

  const averagePerDay = result.total / Math.max(p.days.length, 1)
  const costPerExecution = result.executions > 0 ? result.total / result.executions : null

  return (
    <section className="space-y-4">
      {header}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          title="Gasto no período"
          value={usd(result.total)}
          detail={<Delta value={result.deltaPct} label={p.prev.short} />}
        />
        {p.key === 'mes' ? (
          <Kpi
            title="Projeção para o mês"
            value={result.projection === null ? '—' : usd(result.projection)}
            detail={
              <span className="text-muted-foreground">
                {result.projection === null ? 'disponível a partir do 3º dia' : 'mantido o ritmo atual'}
              </span>
            }
          />
        ) : (
          <Kpi
            title="Média por dia"
            value={usd(averagePerDay)}
            detail={<span className="text-muted-foreground">{p.days.length} dias</span>}
          />
        )}
        <Kpi
          title="Custo por execução"
          value={costPerExecution === null ? '—' : usdUnit(costPerExecution)}
          detail={
            <span className="text-muted-foreground">
              {integer.format(result.executions)} execuções · {activeAgents.length} agente{activeAgents.length === 1 ? '' : 's'}
            </span>
          }
        />
        <Kpi
          title="Tokens"
          value={compact.format(result.tokens)}
          detail={<span className="text-muted-foreground">entrada + saída</span>}
        />
      </div>

      {result.missingPrice.models.length > 0 && (
        <Alert className="border-amber-500/40">
          <AlertTriangle className="text-amber-400" aria-hidden />
          <AlertTitle>Valores subestimados: modelo sem preço cadastrado</AlertTitle>
          <AlertDescription>
            {compact.format(result.missingPrice.tokens)} tokens de{' '}
            {result.missingPrice.models.map((m, i) => (
              <span key={m}>
                {i > 0 && ', '}
                <code className="font-mono text-xs text-foreground">{m}</code>
              </span>
            ))}{' '}
            entraram como US$ 0. Cadastre o preço em <code className="font-mono text-xs">model_pricing</code>.
          </AlertDescription>
        </Alert>
      )}

      {silentAgents.length > 0 && (
        <Alert className="border-amber-500/40">
          <BotOff className="text-amber-400" aria-hidden />
          <AlertTitle>
            {silentAgents.length === 1 ? 'Um agente parou de consumir' : `${silentAgents.length} agentes pararam de consumir`}
          </AlertTitle>
          <AlertDescription>
            {silentAgents.map((a) => a.name).join(', ')}{' '}
            {silentAgents.length === 1 ? 'teve gasto' : 'tiveram gasto'} {p.prev.em} e nenhum agora.
            Queda para zero costuma ser agente fora do ar, não economia — confira a instância e o
            workflow.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gasto diário</CardTitle>
          <CardDescription>Por agente, no horário de Brasília</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <DailyChart daily={result.daily} series={result.series} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Por agente</CardTitle>
          <CardDescription>Variação comparada com {p.prev.com}</CardDescription>
        </CardHeader>
        <CardContent>
          <AgentsTable agents={agents} prevCom={p.prev.com} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Custo estimado com os preços de <code className="font-mono">model_pricing</code>, não é a fatura
        dos provedores. Última execução coletada: {dateTime(result.lastCollection)}.
      </p>
    </section>
  )
}
