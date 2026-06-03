'use client'

import { useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ExternalLink, Power, PowerOff } from 'lucide-react'

import { InstanceStatusBadge } from './instance-status-badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Tables } from '@/types/database'

type InstanceWithClient = Tables<'instances'> & {
  client: Pick<Tables<'clients'>, 'id' | 'name'> | null
}

interface InstanceTableProps {
  instances: InstanceWithClient[]
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '—'
  return new Date(dateString).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ConnectButton({ instanceId }: { instanceId: string }) {
  return (
    <Button
      size="sm"
      variant="outline"
      render={<Link href={`/instances/${instanceId}?tab=connection`} />}
      className="gap-1"
    >
      <Power className="size-3" />
      Conectar
    </Button>
  )
}

function DisconnectButton({ instanceId }: { instanceId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  async function handleDisconnect() {
    try {
      const res = await fetch(`/api/instances/${instanceId}/disconnect`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Falha ao desconectar')
      }
      toast.success('Instância desconectada')
      startTransition(() => router.refresh())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Falha ao desconectar')
    }
  }

  return (
    <Button
      size="sm"
      variant="destructive"
      onClick={handleDisconnect}
      disabled={isPending}
      className="gap-1"
    >
      <PowerOff className="size-3" />
      {isPending ? 'Desconectando...' : 'Desconectar'}
    </Button>
  )
}

export function InstanceTable({ instances }: InstanceTableProps) {
  if (instances.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card py-12 text-center text-muted-foreground">
        Nenhuma instância encontrada.
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Status</TableHead>
          <TableHead>Nome da instância</TableHead>
          <TableHead>Telefone</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Última desconexão</TableHead>
          <TableHead className="text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {instances.map((instance) => (
          <TableRow key={instance.id}>
            <TableCell>
              <InstanceStatusBadge status={instance.status} />
            </TableCell>
            <TableCell className="font-medium">
              {instance.name}
            </TableCell>
            <TableCell>
              {instance.phone_connected ?? '—'}
            </TableCell>
            <TableCell>
              {instance.client ? (
                <Link
                  href={`/clients/${instance.client.id}`}
                  className="hover:underline text-foreground"
                >
                  {instance.client.name}
                </Link>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell>
              {formatDate(instance.last_disconnected_at)}
            </TableCell>
            <TableCell>
              <div className="flex items-center justify-end gap-2">
                <Button size="sm" variant="ghost" render={<Link href={`/instances/${instance.id}`} />} className="gap-1">
                  <ExternalLink className="size-3" />
                  Ver
                </Button>

                {instance.status === 'disconnected' ? (
                  <ConnectButton instanceId={instance.id} />
                ) : (
                  <DisconnectButton instanceId={instance.id} />
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
