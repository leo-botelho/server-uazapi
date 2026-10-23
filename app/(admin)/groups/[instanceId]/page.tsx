import { Suspense } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { CalendarClock, ChevronLeft } from 'lucide-react'

import { GroupWorkspace } from './group-workspace'
import { MigrationPending } from '@/components/admin/groups/migration-pending'
import { InstanceStatusBadge } from '@/components/admin/instance-status-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cacheEstaVelho, idadeDoCacheEmMinutos, listarGruposEmCache } from '@/lib/groups/cache'
import { verificarInstalacaoDeGrupos } from '@/lib/groups/install'
import { createClient } from '@/lib/supabase/server'

function textoDaIdade(minutos: number | null): string {
  if (minutos === null) return 'Lista ainda não carregada'
  if (minutos < 1) return 'Atualizada agora há pouco'
  if (minutos < 60) return `Atualizada há ${Math.round(minutos)} min`
  const horas = Math.round(minutos / 60)
  return `Atualizada há ${horas} h`
}

async function Conteudo({ instanceId }: { instanceId: string }) {
  const instalacao = await verificarInstalacaoDeGrupos()

  if (instalacao.estado === 'pendente') return <MigrationPending detalhe={instalacao.detalhe} />

  if (instalacao.estado === 'erro') {
    return (
      <Alert variant="destructive">
        <AlertTitle>Não foi possível consultar o banco</AlertTitle>
        <AlertDescription>{instalacao.detalhe}</AlertDescription>
      </Alert>
    )
  }

  const supabase = await createClient()
  const { data: instance } = await supabase
    .from('instances')
    .select('id, name, status, phone_connected')
    .eq('id', instanceId)
    .eq('active', true)
    .maybeSingle()

  if (!instance) notFound()

  const grupos = await listarGruposEmCache(instance.id)
  const idade = idadeDoCacheEmMinutos(grupos)

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/groups"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Todas as instâncias
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">{instance.name}</h1>
          <InstanceStatusBadge status={instance.status} />
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/groups/${instance.id}/agenda`} />}
            nativeButton={false}
            className="ml-auto gap-1.5"
          >
            <CalendarClock className="size-4" aria-hidden />
            Agendamentos
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          {textoDaIdade(idade)}
          {instance.phone_connected && ` · ${instance.phone_connected}`}
        </p>
      </div>

      <GroupWorkspace
        instanceId={instance.id}
        instanceName={instance.name}
        grupos={grupos}
        precisaAtualizar={cacheEstaVelho(grupos)}
      />
    </div>
  )
}

function Carregando() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-72" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    </div>
  )
}

export default async function GroupsInstancePage({
  params,
}: {
  params: Promise<{ instanceId: string }>
}) {
  // A service role ignora RLS, e o cache de grupos só é legível por ela. Confere
  // o login aqui antes de usá-la, em vez de depender só do layout.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { instanceId } = await params

  return (
    <Suspense fallback={<Carregando />}>
      <Conteudo instanceId={instanceId} />
    </Suspense>
  )
}
