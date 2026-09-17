import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, BotOff, Database, Minus, RefreshCwOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { loadAiCosts, OTHERS_SERIES, PERIODS, type AgentCost, type CostsResult, type PeriodKey } from '@/lib/ai-costs'
import { FX_MAX_BRL, FX_MIN_BRL, type FxInfo } from '@/lib/ai-costs-fx'

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
const brlFull  = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const brlFour  = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 4, maximumFractionDigits: 4 })
const compact  = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
const integer  = new Intl.NumberFormat('pt-BR')
const pct0     = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const rateFmt  = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

/**
 * Formatacao de valores em duas moedas.
 *
 * O custo nasce em dolar (precos dos provedores). Com cotacao valida, o valor
 * principal e em reais — e o que efetivamente sai do caixa — e o dolar aparece
 * como referencia. Sem cotacao utilizavel, tudo fica so em dolar.
 *
 * Totais com 2 casas; abaixo de 1 centavo, 4 casas, para gasto real nao
 * aparecer como zero. Custo unitario sempre com 4 casas, alinhando a coluna.
 */
interface Money {
  hasBrl: boolean
  main: (usd: number) => string
  sub: (usd: number) => string | null
  unit: (usd: number) => string
  unitSub: (usd: number) => string | null
  /** As duas moedas numa linha, para tooltip e leitor de tela. */
  both: (usd: number) => string
}

function small(full: Intl.NumberFormat, four: Intl.NumberFormat, value: number): string {
  return value > 0 && value < 0.01 ? four.format(value) : full.format(value)
}

function makeMoney(rate: number | null): Money {
  const usd = (v: number) => small(usdFull, usdFour, v)
  if (rate === null) {
    return {
      hasBrl: false,
      main: usd,
      sub: () => null,
      unit: (v) => usdFour.format(v),
      unitSub: () => null,
      both: usd,
    }
  }
  const brl = (v: number) => small(brlFull, brlFour, v * rate)
  return {
    hasBrl: true,
    main: brl,
    sub: usd,
    unit: (v) => brlFour.format(v * rate),
    unitSub: (v) => usdFour.format(v),
    both: (v) => `${brl(v)} (${usd(v)})`,
  }
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

function Kpi({
  title, value, sub, detail,
}: {
  title: string
  value: string
  sub?: string | null
  detail: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      {sub && <p className="text-sm tabular-nums text-muted-foreground">{sub}</p>}
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
  daily, series, money,
}: {
  daily: { day: string; total: number; segments: { series: string; cost: number }[] }[]
  series: string[]
  money: Money
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
        aria-label={`Gasto diário por agente: ${money.both(total)} em ${daily.length} dias, pico de ${money.both(max)} em um dia.`}
        className="relative"
      >
        {/* Guias de escala */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-44">
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-border" />
          <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border/60" />
          <span className="absolute right-0 -top-5 text-[11px] tabular-nums text-muted-foreground">{money.main(max)}</span>
        </div>

        <div className="flex h-44 items-end gap-[2px] border-b border-border">
          {daily.map((bar) => (
            <div
              key={bar.day}
              className="group flex h-full min-w-0 flex-1 flex-col-reverse"
              title={
                bar.total > 0
                  ? `${shortDay(bar.day)} — ${money.both(bar.total)}\n` +
                    bar.segments.map((s) => `${s.series}: ${money.both(s.cost)}`).join('\n')
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

function AgentsTable({ agents, prevCom, money }: { agents: AgentCost[]; prevCom: string; money: Money }) {
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
            <TableCell className="text-right tabular-nums">
              <div className="font-medium">{money.main(a.cost)}</div>
              {money.hasBrl && <div className="text-xs text-muted-foreground">{money.sub(a.cost)}</div>}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${a.share * 100}%` }} />
                </div>
                <span className="w-9 text-right text-xs tabular-nums">{pct0.format(a.share * 100)}%</span>
              </div>
            </TableCell>
            <TableCell className="text-right text-xs tabular-nums">
              <span title={`Em ${prevCom}: ${money.both(a.prevCost)}`}>
                <Delta value={a.deltaPct} />
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">{integer.format(a.executions)}</TableCell>
            <TableCell className="text-right tabular-nums">{integer.format(a.conversations)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {a.costPerExecution === null ? '—' : (
                <>
                  <div>{money.unit(a.costPerExecution)}</div>
                  {money.hasBrl && <div className="text-xs text-muted-foreground">{money.unitSub(a.costPerExecution)}</div>}
                </>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{compact.format(a.tokens)}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {a.models.map((m) => (
                  <Badge
                    key={m}
                    variant="outline"
                    className={cn('font-mono text-[11px]', a.missingPriceModels.includes(m) && 'border-amber-500/50 text-amber-400')}
                    title={a.missingPriceModels.includes(m) ? 'Sem preço cadastrado: contado como zero' : undefined}
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

function ageText(hours: number | null): string {
  if (hours === null) return 'sem data de atualização'
  if (hours < 48) return `há ${Math.max(1, Math.round(hours))} h`
  return `há ${Math.floor(hours / 24)} dias`
}

/** Aviso quando a cotacao nao e confiavel. Cotacao boa ou ausente: nada. */
function FxAlert({ fx }: { fx: FxInfo }) {
  if (fx.status === 'stale') {
    return (
      <Alert className="border-amber-500/40">
        <RefreshCwOff className="text-amber-400" aria-hidden />
        <AlertTitle>Cotação do dólar desatualizada</AlertTitle>
        <AlertDescription>
          Última atualização {ageText(fx.ageHours)} ({dateTime(fx.updatedAt)}). Os valores em reais
          usam essa cotação — confira se o fluxo de cotação no n8n está rodando.
        </AlertDescription>
      </Alert>
    )
  }

  if (fx.status === 'invalid') {
    const gravado = fx.rawRate === null ? 'um valor não numérico' : rateFmt.format(fx.rawRate)
    return (
      <Alert className="border-amber-500/40">
        <AlertTriangle className="text-amber-400" aria-hidden />
        <AlertTitle>Cotação fora do esperado — valores exibidos só em dólar</AlertTitle>
        <AlertDescription>
          {fx.looksInverted ? (
            <>
              A tabela <code className="font-mono text-xs">exchange_rate</code> tem {gravado}, que parece
              ser a cotação invertida (quanto vale 1 real em dólar). O painel espera quantos reais vale
              1 dólar, por exemplo 5,31.
            </>
          ) : (
            <>
              A tabela <code className="font-mono text-xs">exchange_rate</code> tem {gravado}, fora da
              faixa esperada de {FX_MIN_BRL} a {FX_MAX_BRL} reais por dólar. Confira o fluxo de cotação
              no n8n.
            </>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  return null
}

/** Rodape explicando a conversao. */
function FxFootnote({ fx }: { fx: FxInfo }) {
  if (fx.status === 'missing') {
    return (
      <p>
        Sem cotação em <code className="font-mono">exchange_rate</code>: valores só em dólar.
      </p>
    )
  }
  if (fx.rate === null) return null
  return (
    <p>
      Convertido para reais pela cotação de US$ 1 = R$ {rateFmt.format(fx.rate)}, atualizada em{' '}
      {dateTime(fx.updatedAt)}. Períodos anteriores usam a mesma cotação, não a do dia do gasto.
    </p>
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
  const money = makeMoney(result.state === 'ok' ? result.fx.rate : null)

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold">Gastos com IA por agente</h2>
        <p className="text-sm text-muted-foreground">
          Estimativa {money.hasBrl ? 'em reais e dólares' : 'em dólares'} a partir dos tokens consumidos pelos agentes no n8n
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
                No n8n, importe o workflow <strong>Coleta de Tokens</strong> atualizado e aponte a
                credencial deste Supabase nos nós <strong>Le Watermark</strong>, <strong>Grava Uso</strong>{' '}
                e <strong>Atualiza Watermark</strong>. Só <strong>Busca Pendentes</strong> continua no
                banco interno do n8n.
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
          value={money.main(result.total)}
          sub={money.sub(result.total)}
          detail={<Delta value={result.deltaPct} label={p.prev.short} />}
        />
        {p.key === 'mes' ? (
          <Kpi
            title="Projeção para o mês"
            value={result.projection === null ? '—' : money.main(result.projection)}
            sub={result.projection === null ? null : money.sub(result.projection)}
            detail={
              <span className="text-muted-foreground">
                {result.projection === null ? 'disponível a partir do 3º dia' : 'mantido o ritmo atual'}
              </span>
            }
          />
        ) : (
          <Kpi
            title="Média por dia"
            value={money.main(averagePerDay)}
            sub={money.sub(averagePerDay)}
            detail={<span className="text-muted-foreground">{p.days.length} dias</span>}
          />
        )}
        <Kpi
          title="Custo por execução"
          value={costPerExecution === null ? '—' : money.unit(costPerExecution)}
          sub={costPerExecution === null ? null : money.unitSub(costPerExecution)}
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

      <FxAlert fx={result.fx} />

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
            entraram como custo zero. Cadastre o preço em <code className="font-mono text-xs">model_pricing</code>.
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
          <DailyChart daily={result.daily} series={result.series} money={money} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Por agente</CardTitle>
          <CardDescription>Variação comparada com {p.prev.com}</CardDescription>
        </CardHeader>
        <CardContent>
          <AgentsTable agents={agents} prevCom={p.prev.com} money={money} />
        </CardContent>
      </Card>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          Custo estimado com os preços de <code className="font-mono">model_pricing</code>, não é a fatura
          dos provedores. Última execução coletada: {dateTime(result.lastCollection)}.
        </p>
        <FxFootnote fx={result.fx} />
      </div>
    </section>
  )
}
