'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
  Activity, AlertCircle, AlertTriangle, CheckCircle, Globe, Loader2,
  MessageSquare, RefreshCw, Rss, ShieldAlert, Webhook,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type {
  WaMessagesLimits, WebhookDeliveryError, InstanceWebhookConfig,
  InstanceProxy, AsyncQueueStatus,
} from '@/lib/uazapi/types'

interface Section<T> {
  data: T | null
  error: string | null
}

interface HealthResponse {
  limits:        Section<WaMessagesLimits>
  webhooks:      Section<InstanceWebhookConfig[]>
  webhookErrors: Section<WebhookDeliveryError[]>
  proxy:         Section<InstanceProxy>
  queue:         Section<AsyncQueueStatus>
}

type Severity = 'ok' | 'warn' | 'danger' | 'unknown'

const severityStyles: Record<Severity, string> = {
  ok:      'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30',
  warn:    'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
  danger:  'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30',
  unknown: 'border-border bg-muted/30',
}

function Card({
  title, icon: Icon, severity, children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  severity: Severity
  children: React.ReactNode
}) {
  return (
    <div className={cn('rounded-lg border p-4 space-y-2', severityStyles[severity])}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 shrink-0" />
        {title}
      </div>
      <div className="text-sm text-muted-foreground space-y-1">{children}</div>
    </div>
  )
}

function formatDate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('pt-BR')
}

export function InstanceHealthPanel({ instanceId }: { instanceId: string }) {
  const [health, setHealth]   = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isRotating, startRotate] = useTransition()

  const fetchHealth = useCallback(async (): Promise<HealthResponse> => {
    const res = await fetch(`/api/instances/${instanceId}/health`, { cache: 'no-store' })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `Falha ao carregar diagnóstico (${res.status})`)
    }
    return (await res.json()) as HealthResponse
  }, [instanceId])

  // Recarga manual (botão) — pode alterar estado de imediato.
  const load = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      setHealth(await fetchHealth())
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Erro ao carregar diagnóstico')
    } finally {
      setLoading(false)
    }
  }, [fetchHealth])

  // Carga inicial: nenhum setState é executado de forma síncrona dentro do
  // effect (só depois do await), evitando renders em cascata.
  useEffect(() => {
    let cancelled = false
    fetchHealth()
      .then((data)  => { if (!cancelled) setHealth(data) })
      .catch((err)  => { if (!cancelled) setFetchError(err instanceof Error ? err.message : 'Erro ao carregar diagnóstico') })
      .finally(()   => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchHealth])

  function rotateProxy() {
    startRotate(async () => {
      try {
        const res = await fetch(`/api/instances/${instanceId}/proxy`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ mode: 'internal', rotate_now: true }),
        })
        const body = (await res.json()) as { error?: string; rotated?: boolean }
        if (!res.ok) throw new Error(body.error ?? 'Falha ao rotacionar o proxy')

        toast.success(
          body.rotated
            ? 'Proxy rotacionado. O novo IP vale a partir da próxima conexão.'
            : 'Solicitação enviada. Confirme o estado abaixo.'
        )
        await load()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao rotacionar o proxy')
      }
    })
  }

  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
        <AlertCircle className="size-4 mt-0.5 shrink-0" />
        <div className="space-y-2">
          <p>{fetchError}</p>
          <Button variant="outline" size="sm" onClick={load}>Tentar novamente</Button>
        </div>
      </div>
    )
  }

  if (!health) return null

  const limits   = health.limits.data
  const capping  = limits?.new_chat_message_capping
  const timelock = limits?.reachout_timelock
  const proxy    = health.proxy.data
  const queue    = health.queue.data?.queue
  const hooks    = health.webhooks.data ?? []
  const hookErrs = health.webhookErrors.data ?? []

  // ── Cota de novas conversas ───────────────────────────────────────────────
  // `can_send_new_messages: null` significa diagnóstico inconclusivo — não é
  // bloqueio, então não pode ser pintado de vermelho.
  const blocked   = limits?.can_send_new_messages === false || timelock?.active === true
  const limitsSev: Severity = health.limits.error
    ? 'unknown'
    : blocked ? 'danger'
    : limits?.can_send_new_messages === true ? 'ok' : 'unknown'

  // ── Proxy ────────────────────────────────────────────────────────────────
  const proxyDrifted = !!proxy && (
    proxy.fallback?.active === true ||
    (proxy.mode === 'custom'   && proxy.effective_mode !== 'custom') ||
    (proxy.mode === 'internal' && proxy.effective_mode === 'direct')
  )
  const proxySev: Severity = health.proxy.error ? 'unknown' : proxyDrifted ? 'warn' : 'ok'

  // ── Fila do agente ───────────────────────────────────────────────────────
  const queueStuck = !!queue && (
    queue.sessionReady === false ||
    queue.acceptingNewMessages === false ||
    (queue.pending ?? 0) > 50
  )
  const queueSev: Severity = health.queue.error ? 'unknown' : queueStuck ? 'warn' : 'ok'

  // ── Webhook do agente (n8n) ──────────────────────────────────────────────
  const disabledHooks = hooks.filter((h) => h.enabled === false)
  const hookSev: Severity = health.webhooks.error
    ? 'unknown'
    : hookErrs.length > 0 ? 'warn'
    : disabledHooks.length > 0 ? 'warn'
    : 'ok'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Sinais lidos direto do uazapiGO. Nenhuma configuração é alterada por esta tela.
        </p>
        <Button variant="ghost" size="sm" onClick={load} className="gap-1.5 shrink-0">
          <RefreshCw className="size-3.5" />
          Atualizar
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">

        {/* ── Cota de novas conversas ───────────────────────────────────── */}
        <Card title="Cota de novas conversas" icon={MessageSquare} severity={limitsSev}>
          {health.limits.error ? (
            <p className="text-xs">Indisponível: {health.limits.error}</p>
          ) : (
            <>
              <p className="font-medium text-foreground">
                {blocked
                  ? 'Bloqueado para iniciar novas conversas'
                  : limits?.can_send_new_messages === true
                    ? 'Liberado para iniciar conversas'
                    : 'Diagnóstico inconclusivo'}
              </p>
              {capping?.available && (
                <p>
                  Usadas <strong className="text-foreground">{capping.used_quota ?? '?'}</strong>
                  {' de '}
                  <strong className="text-foreground">{capping.total_quota ?? '?'}</strong>
                  {capping.cycle_end ? ` — renova em ${formatDate(capping.cycle_end)}` : ''}
                </p>
              )}
              {timelock?.active && (
                <p className="text-red-700 dark:text-red-400">
                  Bloqueio temporal ativo até {formatDate(timelock.until)}
                </p>
              )}
              {limits?.message_ptbr && <p className="text-xs">{limits.message_ptbr}</p>}
            </>
          )}
        </Card>

        {/* ── Webhook do agente (somente leitura) ───────────────────────── */}
        <Card title="Webhook do agente (n8n)" icon={Webhook} severity={hookSev}>
          {health.webhooks.error ? (
            <p className="text-xs">Indisponível: {health.webhooks.error}</p>
          ) : hooks.length === 0 ? (
            <p>Nenhum webhook configurado nesta instância.</p>
          ) : (
            hooks.map((h, i) => (
              <div key={h.id ?? i} className="space-y-0.5">
                <div className="flex items-center gap-2">
                  {h.enabled === false
                    ? <Badge variant="destructive" className="text-xs">desativado</Badge>
                    : <Badge className="bg-green-600 hover:bg-green-600 text-white text-xs">ativo</Badge>}
                  <code className="text-xs truncate">{h.url}</code>
                </div>
                {!!h.events?.length && (
                  <p className="text-xs">{h.events.length} evento(s): {h.events.slice(0, 4).join(', ')}
                    {h.events.length > 4 ? '…' : ''}</p>
                )}
              </div>
            ))
          )}
          {hookErrs.length > 0 && (
            <p className="text-amber-700 dark:text-amber-400 text-xs pt-1">
              {hookErrs.length} erro(s) de entrega recentes — último:{' '}
              {hookErrs[0]?.status_code ?? '?'} em {formatDate(hookErrs[0]?.created)}
            </p>
          )}
        </Card>

        {/* ── Proxy ─────────────────────────────────────────────────────── */}
        <Card title="Conexão / proxy" icon={Globe} severity={proxySev}>
          {health.proxy.error ? (
            <p className="text-xs">Indisponível: {health.proxy.error}</p>
          ) : (
            <>
              <p>
                Configurado: <strong className="text-foreground">{proxy?.mode ?? '—'}</strong>
                {' · '}
                Em uso: <strong className="text-foreground">{proxy?.effective_mode ?? '—'}</strong>
              </p>
              {proxy?.fallback?.active && (
                <p className="text-amber-700 dark:text-amber-400">
                  Rodando em fallback{proxy.fallback.reason ? ` (${proxy.fallback.reason})` : ''}
                  {proxy.fallback.since ? ` desde ${formatDate(proxy.fallback.since)}` : ''}
                </p>
              )}
              {proxy?.last_test_error && (
                <p className="text-xs">Último teste: {proxy.last_test_error}</p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-2 gap-1.5"
                onClick={rotateProxy}
                disabled={isRotating}
              >
                {isRotating ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                Rotacionar IP
              </Button>
            </>
          )}
        </Card>

        {/* ── Fila de envio ─────────────────────────────────────────────── */}
        <Card title="Fila de envio" icon={Activity} severity={queueSev}>
          {health.queue.error ? (
            <p className="text-xs">Indisponível: {health.queue.error}</p>
          ) : (
            <>
              <p>
                Estado: <strong className="text-foreground">{queue?.status ?? '—'}</strong>
                {' · '}
                Pendentes: <strong className="text-foreground">{queue?.pending ?? 0}</strong>
              </p>
              <p className="flex items-center gap-1.5 text-xs">
                {queue?.sessionReady
                  ? <><CheckCircle className="size-3 text-green-600" /> Sessão pronta</>
                  : <><ShieldAlert className="size-3 text-amber-600" /> Sessão não está pronta</>}
              </p>
              {queue?.acceptingNewMessages === false && (
                <p className="text-amber-700 dark:text-amber-400 text-xs">
                  Não está aceitando novas mensagens.
                </p>
              )}
            </>
          )}
        </Card>
      </div>

      {hookErrs.length > 0 && (
        <div className="rounded-lg border p-4 space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Rss className="size-4" />
            Erros de entrega para o n8n
          </p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {hookErrs.slice(0, 10).map((e, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0 text-amber-600" />
                <span className="text-muted-foreground">
                  <strong className="text-foreground">{e.status_code ?? 'erro'}</strong>
                  {e.event ? ` · ${e.event}` : ''}
                  {e.attempts ? ` · ${e.attempts} tentativa(s)` : ''}
                  {' · '}{formatDate(e.created)}
                  {e.error ? ` — ${e.error.slice(0, 160)}` : ''}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Histórico mantido em memória pelo uazapiGO — zera quando o servidor reinicia.
          </p>
        </div>
      )}
    </div>
  )
}
