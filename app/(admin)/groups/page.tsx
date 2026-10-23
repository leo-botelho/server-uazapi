import { Suspense } from 'react'
import Link from 'next/link'
import { ChevronRight, Smartphone, UsersRound } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { verificarInstalacaoDeGrupos } from '@/lib/groups/install'
import { MigrationPending } from '@/components/admin/groups/migration-pending'
import { InstanceStatusBadge } from '@/components/admin/instance-status-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * Entrada do módulo de grupos.
 *
 * O gerenciamento é POR INSTÂNCIA: cada instância é um número de WhatsApp com
 * seus próprios grupos, e nenhuma operação faz sentido sem escolher qual.
 */

async function EscolhaDeInstancia() {
  const instalacao = await verificarInstalacaoDeGrupos()

  if (instalacao.estado === 'pendente') {
    return <MigrationPending detalhe={instalacao.detalhe} />
  }

  if (instalacao.estado === 'erro') {
    return (
      <Alert variant="destructive">
        <AlertTitle>Não foi possível consultar o banco</AlertTitle>
        <AlertDescription>{instalacao.detalhe}</AlertDescription>
      </Alert>
    )
  }

  const supabase = await createClient()
  const { data: instances } = await supabase
    .from('instances')
    .select('id, name, status, phone_connected, missing_since, client:clients(id, name)')
    .eq('active', true)
    .order('name')

  if (!instances || instances.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Nenhuma instância cadastrada. Cadastre uma em{' '}
          <Link href="/instances" className="text-foreground hover:underline">
            Instâncias
          </Link>{' '}
          para começar.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {instances.map((instance) => (
        <Link
          key={instance.id}
          href={`/groups/${instance.id}`}
          className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-ring hover:bg-muted/40"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <p className="truncate font-medium">{instance.name}</p>
              <p className="truncate text-sm text-muted-foreground">
                {instance.client?.name ?? 'Sem cliente vinculado'}
              </p>
            </div>
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
          </div>

          <div className="mt-3 flex items-center gap-2">
            <InstanceStatusBadge status={instance.status} />
            {instance.phone_connected && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Smartphone className="size-3" aria-hidden />
                {instance.phone_connected}
              </span>
            )}
          </div>
        </Link>
      ))}
    </div>
  )
}

function Carregando() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full" />
      ))}
    </div>
  )
}

export default function GroupsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <UsersRound className="size-7" aria-hidden />
          Grupos
        </h1>
        <p className="text-muted-foreground">
          Escolha a instância para ver e gerenciar os grupos dela
        </p>
      </div>

      <Suspense fallback={<Carregando />}>
        <EscolhaDeInstancia />
      </Suspense>
    </div>
  )
}
