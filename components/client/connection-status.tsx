'use client'

import { useState, useEffect } from 'react'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | string

interface ConnectionStatusProps {
  instanceId: string
  initialStatus: ConnectionStatus
}

interface StatusResponse {
  status: string
}

function StatusIcon({ status }: { status: ConnectionStatus }) {
  if (status === 'connected') {
    return <CheckCircle className="size-6 text-green-600 dark:text-green-400" />
  }
  if (status === 'connecting') {
    return <Loader2 className="size-6 animate-spin text-yellow-600 dark:text-yellow-400" />
  }
  return <XCircle className="size-6 text-red-600 dark:text-red-400" />
}

function statusLabel(status: ConnectionStatus): string {
  if (status === 'connected') return 'Connected'
  if (status === 'connecting') return 'Connecting...'
  return 'Disconnected'
}

function statusTextClass(status: ConnectionStatus): string {
  if (status === 'connected') return 'text-green-700 dark:text-green-400'
  if (status === 'connecting') return 'text-yellow-700 dark:text-yellow-400'
  return 'text-red-700 dark:text-red-400'
}

export function ConnectionStatus({ instanceId, initialStatus }: ConnectionStatusProps) {
  const [status, setStatus] = useState<ConnectionStatus>(initialStatus)

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/connect/status?instanceId=${encodeURIComponent(instanceId)}`,
          { cache: 'no-store' }
        )
        if (res.ok) {
          const data = (await res.json()) as StatusResponse
          setStatus(data.status)
        }
      } catch {
        // silently ignore poll errors
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [instanceId])

  return (
    <div className="flex items-center gap-2">
      <StatusIcon status={status} />
      <span className={cn('text-sm font-medium', statusTextClass(status))}>
        {statusLabel(status)}
      </span>
    </div>
  )
}
