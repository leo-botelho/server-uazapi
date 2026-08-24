'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertTriangle, CheckCircle, RefreshCw, Info } from 'lucide-react'
import type { WebhookDeliveryError } from '@/lib/uazapi/types'

/**
 * Saúde da entrega do webhook global — ou seja, do próprio painel.
 *
 * Este é o canal que alimenta o status das instâncias. Quando ele falha, o
 * painel fica cego e nada na tela indicava isso: foi assim que o webhook ficou
 * `enabled: false` apontando para a URL errada sem ninguém perceber.
 */
export function GlobalWebhookHealth() {
  const [errors, setErrors]       = useState<WebhookDeliveryError[]>([])
  const [unsupported, setUnsup]   = useState(false)
  const [loading, setLoading]     = useState(true)
  const [fetchError, setFetchErr] = useState<string | null>(null)

  const fetchErrors = useCallback(async () => {
    const res  = await fetch('/api/webhook/global/errors', { cache: 'no-store' })
    const body = (await res.json()) as {
      errors?: WebhookDeliveryError[]
      unsupported?: boolean
      error?: string
    }
    if (!res.ok) throw new Error(body.error ?? `Falha ao consultar (${res.status})`)
    return { errors: body.errors ?? [], unsupported: !!body.unsupported }
  }, [])

  // Recarga manual (botão).
  const load = useCallback(async () => {
    setLoading(true)
    setFetchErr(null)
    try {
      const result = await fetchErrors()
      setErrors(result.errors)
      setUnsup(result.unsupported)
    } catch (err) {
      setFetchErr(err instanceof Error ? err.message : 'Erro ao consultar erros de entrega')
    } finally {
      setLoading(false)
    }
  }, [fetchErrors])

  // Carga inicial sem setState síncrono dentro do effect.
  useEffect(() => {
    let cancelled = false
    fetchErrors()
      .then((result) => {
        if (cancelled) return
        setErrors(result.errors)
        setUnsup(result.unsupported)
      })
      .catch((err) => { if (!cancelled) setFetchErr(err instanceof Error ? err.message : 'Erro ao consultar erros de entrega') })
      .finally(()  => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchErrors])

  if (loading) return <Skeleton className="h-20 w-full" />

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Últimas falhas de entrega registradas pelo uazapiGO ao chamar este painel.
        </p>
        <Button variant="ghost" size="sm" onClick={load} className="gap-1.5 shrink-0">
          <RefreshCw className="size-3.5" />
          Atualizar
        </Button>
      </div>

      {fetchError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          {fetchError}
        </div>
      )}

      {!fetchError && unsupported && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400">
          <Info className="size-4 mt-0.5 shrink-0" />
          Este servidor uazapiGO não expõe o histórico de erros do webhook global.
        </div>
      )}

      {!fetchError && !unsupported && errors.length === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
          <CheckCircle className="size-4 mt-0.5 shrink-0" />
          Nenhuma falha de entrega registrada.
        </div>
      )}

      {errors.length > 0 && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto rounded-lg border p-3">
          {errors.slice(0, 20).map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <AlertTriangle className="size-3.5 mt-0.5 shrink-0 text-amber-600" />
              <span className="text-muted-foreground">
                <strong className="text-foreground">{e.status_code ?? 'erro'}</strong>
                {e.event ? ` · ${e.event}` : ''}
                {e.attempts ? ` · ${e.attempts} tentativa(s)` : ''}
                {e.created ? ` · ${new Date(e.created).toLocaleString('pt-BR')}` : ''}
                {e.error ? ` — ${e.error.slice(0, 200)}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Falhas repetidas de entrega podem fazer o servidor desativar o webhook
        (<code className="font-mono">enabled: false</code>) — se isso acontecer, o painel para de
        receber mudanças de status e passa a depender só do monitor ativo.
      </p>
    </div>
  )
}
