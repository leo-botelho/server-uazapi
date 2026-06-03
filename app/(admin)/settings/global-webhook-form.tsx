'use client'

import { useState, useEffect, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Save, Loader2, Copy, CheckCircle, AlertCircle, Info,
  Globe, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { GlobalWebhookResponse } from '@/lib/uazapi/types'

const EVENTS = [
  {
    value: 'connection',
    label: 'connection',
    description: 'Conexão e desconexão de instâncias — necessário para monitoramento',
    recommended: true,
  },
  { value: 'messages',          label: 'messages',          description: 'Novas mensagens recebidas' },
  { value: 'messages_update',   label: 'messages_update',   description: 'Atualizações em mensagens existentes' },
  { value: 'history',           label: 'history',           description: 'Histórico de mensagens sincronizado' },
  { value: 'groups',            label: 'groups',            description: 'Criação e alterações em grupos' },
  { value: 'chats',             label: 'chats',             description: 'Eventos de conversas' },
  { value: 'contacts',          label: 'contacts',          description: 'Atualização de contatos' },
  { value: 'presence',          label: 'presence',          description: 'Status de presença (online/offline)' },
  { value: 'labels',            label: 'labels',            description: 'Etiquetas gerenciadas' },
  { value: 'chat_labels',       label: 'chat_labels',       description: 'Etiquetas associadas a conversas' },
  { value: 'call',              label: 'call',              description: 'Chamadas VoIP' },
  { value: 'blocks',            label: 'blocks',            description: 'Bloqueios e desbloqueios de contatos' },
  { value: 'sender',            label: 'sender',            description: 'Início e conclusão de campanhas de envio' },
  { value: 'newsletter_messages', label: 'newsletter_messages', description: 'Mensagens de newsletter / canal' },
] as const

export function GlobalWebhookForm() {
  const [isLoading, setIsLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [current, setCurrent] = useState<GlobalWebhookResponse | null>(null)
  const [url, setUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['connection'])
  const [urlCopied, setUrlCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  const suggestedUrl =
    (process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin) + '/api/webhook'

  function load() {
    setIsLoading(true)
    setFetchError(null)
    fetch('/api/webhook/global')
      .then((r) => r.json())
      .then((data: GlobalWebhookResponse | null) => {
        setCurrent(data)
        if (data?.url) {
          setUrl(data.url)
          setSelectedEvents(data.events ?? ['connection'])
        } else {
          setUrl(suggestedUrl)
          setSelectedEvents(['connection'])
        }
      })
      .catch(() => {
        setFetchError('Não foi possível carregar a configuração. Verifique a URL e o token do servidor.')
        setUrl(suggestedUrl)
      })
      .finally(() => setIsLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  function toggleEvent(value: string) {
    setSelectedEvents((prev) =>
      prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value]
    )
  }

  function copyUrl() {
    navigator.clipboard.writeText(url || suggestedUrl).then(() => {
      setUrlCopied(true)
      setTimeout(() => setUrlCopied(false), 2000)
    })
  }

  function useSuggestedUrl() {
    setUrl(suggestedUrl)
  }

  function handleSave() {
    if (!url.trim()) {
      toast.error('Informe a URL do webhook')
      return
    }
    if (selectedEvents.length === 0) {
      toast.error('Selecione ao menos um evento')
      return
    }

    startTransition(async () => {
      try {
        const res = await fetch('/api/webhook/global', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: url.trim(),
            events: selectedEvents,
            excludeMessages: [],
          }),
        })

        if (!res.ok) {
          const data = (await res.json()) as { error?: string }
          throw new Error(data.error ?? 'Erro ao salvar webhook global')
        }

        const result = (await res.json()) as GlobalWebhookResponse
        setCurrent(result)
        toast.success('Webhook global configurado com sucesso!')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao salvar webhook global')
      }
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Carregando configuração atual...
      </div>
    )
  }

  const isConfigured = !!(current?.url)

  return (
    <div className="space-y-6">

      {/* Status + Reload */}
      <div className="flex items-center gap-3">
        {isConfigured ? (
          <Badge className="gap-1.5 bg-green-600 hover:bg-green-600 text-white">
            <CheckCircle className="size-3" />
            Configurado
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1.5">
            <AlertCircle className="size-3" />
            Não configurado
          </Badge>
        )}
        {isConfigured && (
          <code className="text-xs text-muted-foreground truncate max-w-xs">
            {current?.url}
          </code>
        )}
        <Button variant="ghost" size="icon" className="size-7 ml-auto" onClick={load} title="Recarregar">
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      {/* Erro de fetch */}
      {fetchError && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          {fetchError}
        </div>
      )}

      {/* Info */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400">
        <Info className="size-4 mt-0.5 shrink-0" />
        <p>
          O webhook global envia eventos de <strong>todas as instâncias</strong> para uma única URL,{' '}
          sem alterar as configurações individuais de cada instância.{' '}
          Para este painel de monitoramento, selecione apenas <strong>connection</strong>.{' '}
          Eventos de mensagens continuam sendo tratados pelos agentes de IA via n8n.
        </p>
      </div>

      {/* URL */}
      <div className="space-y-2">
        <Label htmlFor="wh-url">URL de destino</Label>
        <div className="flex gap-2">
          <Input
            id="wh-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={suggestedUrl}
            className="font-mono text-sm"
          />
          <Button variant="outline" size="icon" onClick={copyUrl} title="Copiar URL">
            {urlCopied
              ? <CheckCircle className="size-4 text-green-600" />
              : <Copy className="size-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          URL desta aplicação onde o uazapiGO enviará os eventos.{' '}
          <button
            type="button"
            onClick={useSuggestedUrl}
            className="text-primary hover:underline font-mono"
          >
            Usar: {suggestedUrl}
          </button>
        </p>
      </div>

      {/* Eventos */}
      <div className="space-y-2">
        <Label>Eventos monitorados</Label>
        <div className="grid gap-1.5">
          {EVENTS.map((ev) => {
            const isSelected = selectedEvents.includes(ev.value)
            return (
              <button
                key={ev.value}
                type="button"
                onClick={() => toggleEvent(ev.value)}
                className={cn(
                  'flex items-center gap-3 rounded-lg border px-4 py-2.5 text-left transition-colors',
                  isSelected
                    ? 'border-primary/50 bg-primary/5 dark:bg-primary/10'
                    : 'border-border bg-card hover:bg-muted/40'
                )}
              >
                {/* checkbox visual */}
                <span
                  className={cn(
                    'size-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors',
                    isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                  )}
                >
                  {isSelected && (
                    <CheckCircle className="size-3 text-white fill-white stroke-white" />
                  )}
                </span>

                <span className="flex-1 min-w-0">
                  <span className={cn('font-mono text-sm font-medium', isSelected ? 'text-foreground' : 'text-muted-foreground')}>
                    {ev.value}
                  </span>
                  <span className="block text-xs text-muted-foreground truncate">
                    {ev.description}
                  </span>
                </span>

                {'recommended' in ev && ev.recommended && (
                  <Badge variant="secondary" className="text-xs shrink-0">
                    recomendado
                  </Badge>
                )}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {selectedEvents.length === 0
            ? 'Nenhum evento selecionado'
            : `${selectedEvents.length} evento${selectedEvents.length > 1 ? 's' : ''} selecionado${selectedEvents.length > 1 ? 's' : ''}`}
        </p>
      </div>

      <Button onClick={handleSave} disabled={isPending} className="gap-2">
        {isPending
          ? <Loader2 className="size-4 animate-spin" />
          : <Save className="size-4" />}
        {isPending ? 'Salvando...' : 'Salvar webhook global'}
      </Button>
    </div>
  )
}
