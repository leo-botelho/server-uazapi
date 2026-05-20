'use client'

import { Badge } from '@/components/ui/badge'
import { Wifi, WifiOff, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type InstanceStatus = 'connected' | 'disconnected' | 'connecting'

const statusConfig: Record<
  InstanceStatus,
  { label: string; className: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  connected: {
    label: 'Connected',
    className: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
    Icon: Wifi,
  },
  disconnected: {
    label: 'Disconnected',
    className: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
    Icon: WifiOff,
  },
  connecting: {
    label: 'Connecting',
    className: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800',
    Icon: Loader2,
  },
}

export function InstanceStatusBadge({ status }: { status: InstanceStatus }) {
  const { label, className, Icon } = statusConfig[status]

  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 border font-medium', className)}
    >
      <Icon
        className={cn(
          'size-3',
          status === 'connecting' && 'animate-spin'
        )}
      />
      {label}
    </Badge>
  )
}
