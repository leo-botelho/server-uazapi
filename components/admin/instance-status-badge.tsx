'use client'

import { Badge } from '@/components/ui/badge'
import { Wifi, WifiOff, Loader2, PauseCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { InstanceStatus } from '@/lib/uazapi/types'

const statusConfig: Record<
  InstanceStatus,
  { label: string; className: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  connected: {
    label: 'Conectado',
    className: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
    Icon: Wifi,
  },
  disconnected: {
    label: 'Desconectado',
    className: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800',
    Icon: WifiOff,
  },
  connecting: {
    label: 'Conectando',
    className: 'bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-800',
    Icon: Loader2,
  },
  // Sessão pausada com credenciais preservadas: o agente NÃO está atendendo,
  // mas a reconexão dispensa QR code — por isso cor de alerta, não de erro.
  hibernated: {
    label: 'Hibernada',
    className: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800',
    Icon: PauseCircle,
  },
}

export function InstanceStatusBadge({ status }: { status: InstanceStatus }) {
  // Fallback defensivo: se o uazapiGO passar a devolver um status novo, mostra
  // o valor cru em vez de quebrar a página inteira com um erro de runtime.
  const config = statusConfig[status] ?? {
    label: String(status ?? 'desconhecido'),
    className: 'bg-muted text-muted-foreground border-border',
    Icon: WifiOff,
  }
  const { label, className, Icon } = config

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
