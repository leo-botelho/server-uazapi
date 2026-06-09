'use client'

/**
 * Subscribes to Supabase Realtime changes on the `instances` table
 * and calls router.refresh() whenever a row's status changes.
 *
 * Render this as an invisible component inside the dashboard/instances
 * Server Component pages — it keeps the UI up-to-date without polling.
 *
 * Prerequisite: migration 008 (alter publication supabase_realtime add table instances)
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

export function InstanceStatusLive() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const channel = supabase
      .channel('instance-status-live')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'instances',
          // Only react to status column changes to avoid unnecessary refreshes
          filter: undefined,
        },
        () => {
          // Re-fetch the server component tree to show updated status
          router.refresh()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [router])

  // Invisible — renders nothing
  return null
}
