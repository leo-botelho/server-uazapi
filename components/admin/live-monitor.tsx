'use client'

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Circle, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface LiveEvent {
  id: string
  received_at: string
  event_type: string
  instance_name: string | null
  payload: unknown
}

const EVENT_COLORS: Record<string, string> = {
  connection: 'bg-blue-500',
  messages: 'bg-green-500',
  messages_update: 'bg-green-400',
  groups: 'bg-purple-500',
  presence: 'bg-yellow-500',
  contacts: 'bg-orange-500',
  labels: 'bg-pink-500',
  chats: 'bg-cyan-500',
  sender: 'bg-indigo-500',
  call: 'bg-red-500',
}

function payloadPreview(payload: unknown): string {
  try {
    const str = JSON.stringify(payload)
    return str.length > 120 ? str.slice(0, 120) + '…' : str
  } catch {
    return String(payload)
  }
}

export function LiveMonitor() {
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [connected, setConnected] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const channel = supabase
      .channel('live-webhook-events')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'webhook_events',
        },
        async (payload) => {
          const row = payload.new as {
            id: string
            received_at: string
            event_type: string
            instance_id: string | null
            payload: unknown
          }

          // Fetch instance name separately (not included in Realtime payload join)
          let instanceName: string | null = null
          if (row.instance_id) {
            const { data } = await supabase
              .from('instances')
              .select('name')
              .eq('id', row.instance_id)
              .maybeSingle()
            instanceName = data?.name ?? null
          }

          const newEvent: LiveEvent = {
            id: row.id,
            received_at: row.received_at,
            event_type: row.event_type,
            instance_name: instanceName,
            payload: row.payload,
          }

          setEvents((prev) => [newEvent, ...prev].slice(0, 100))
        }
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED')
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Circle
            className={`size-2.5 fill-current ${connected ? 'text-green-500' : 'text-muted-foreground'}`}
          />
          <span className="text-sm font-medium">
            {connected ? 'Conectado — aguardando eventos' : 'Conectando…'}
          </span>
          {events.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {events.length} evento{events.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEvents([])}
          disabled={events.length === 0}
          className="gap-1 text-muted-foreground"
        >
          <Trash2 className="size-3.5" />
          Limpar
        </Button>
      </div>

      {/* Event stream */}
      <div className="h-96 overflow-y-auto rounded-lg border border-border bg-muted/20 p-2 space-y-1.5 font-mono text-xs">
        {events.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Nenhum evento ainda. Aguardando…
          </div>
        ) : (
          events.map((ev) => (
            <div
              key={ev.id}
              className="flex items-start gap-2 rounded-md border border-border/50 bg-background px-2.5 py-1.5 animate-in fade-in-0 slide-in-from-top-1 duration-200"
            >
              <span
                className={`mt-1 size-2 shrink-0 rounded-full ${EVENT_COLORS[ev.event_type] ?? 'bg-gray-400'}`}
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-foreground">
                    {ev.event_type}
                  </span>
                  {ev.instance_name && (
                    <span className="text-muted-foreground">
                      [{ev.instance_name}]
                    </span>
                  )}
                  <span className="ml-auto text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(ev.received_at), {
                      addSuffix: true,
                      locale: ptBR,
                    })}
                  </span>
                </div>
                <p className="text-muted-foreground break-all leading-relaxed">
                  {payloadPreview(ev.payload)}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
