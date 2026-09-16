'use client'

/**
 * Subscribes to Supabase Realtime changes on the `instances` table
 * and calls router.refresh() when something visible on the page changes.
 *
 * Render this as an invisible component inside the dashboard/instances
 * Server Component pages — it keeps the UI up-to-date without polling.
 *
 * Prerequisite: migration 008 (alter publication supabase_realtime add table instances,
 * replica identity full — needed so `payload.old` carries the previous values).
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

/** Colunas que aparecem na tela. Mudou outra coisa: nao recarrega. */
const VISIBLE_COLUMNS = ['status', 'name', 'phone_connected', 'client_id', 'active'] as const

/** Agrupa rajadas de eventos numa unica recarga. */
const REFRESH_DEBOUNCE_MS = 800

export function InstanceStatusLive() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    let timer: ReturnType<typeof setTimeout> | null = null

    const channel = supabase
      .channel('instance-status-live')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'instances' },
        (payload) => {
          const before = payload.old as Record<string, unknown>
          const after  = payload.new as Record<string, unknown>

          // O monitor grava todas as instancias a cada 2 minutos (last_seen_at,
          // perfil). Recarregar em todo UPDATE refazia a pagina inteira varias
          // vezes seguidas — incluindo as consultas de gastos com IA — sem nada
          // visivel ter mudado. Sem `old` (replica identity incompleta), recarrega
          // por seguranca.
          const hasOld  = before && Object.keys(before).length > 1
          const changed = !hasOld || VISIBLE_COLUMNS.some((col) => before[col] !== after[col])
          if (!changed) return

          if (timer) clearTimeout(timer)
          timer = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS)
        }
      )
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [router])

  // Invisible — renders nothing
  return null
}
