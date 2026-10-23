import { Suspense } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft, TriangleAlert } from 'lucide-react'

import { AgendaList } from './agenda-list'
import { MigrationPending } from '@/components/admin/groups/migration-pending'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { verificarInstalacaoDeGrupos, verificarInstalacaoDoAgendador } from '@/lib/groups/install'
import { createClient } from '@/lib/supabase/server'

/** A 016 ainda não foi aplicada: o envio imediato funciona, mas nada agendado rodaria. */
function AgendadorPendente() {
  return (
    <Card className="border-amber-500/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-400">
          <TriangleAlert className="size-4" aria-hidden />
          Falta aplicar a migration do agendador
        </CardTitle>
        <CardDescription>
          O envio imediato continua funcionando. Mas agendar sem esta migration criaria tarefas que
          nunca rodam, então o painel recusa em vez de deixar isso passar em silêncio.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Abra o SQL Editor do Supabase deste projeto.</li>
          <li>
            Cole o conteúdo de{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">
              supabase/migrations/016_group_scheduler.sql
            </code>{' '}
            e execute.
          </li>
          <li>Recarregue esta página.</li>
        </ol>
      </CardContent>
    </Card>
  )
}

async function Conteudo({ instanceId }: { instanceId: string }) {
  const base = await verificarInstalacaoDeGrupos()
  if (base.estado === 'pendente') return <MigrationPending detalhe={base.detalhe} />

  const agendador = await verificarInstalacaoDoAgendador()

  return (
    <div className="space-y-6">
      {agendador.estado === 'pendente' && <AgendadorPendente />}
      <AgendaList instanceId={instanceId} />
    </div>
  )
}

export default async function AgendaPage({ params }: { params: Promise<{ instanceId: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { instanceId } = await params

  const { data: instance } = await supabase
    .from('instances')
    .select('id, name')
    .eq('id', instanceId)
    .eq('active', true)
    .maybeSingle()

  if (!instance) notFound()

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/groups/${instance.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {instance.name}
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Agendamentos</h1>
        <p className="text-sm text-muted-foreground">
          Envios e alterações marcados para uma data. Rodam sozinhos, com a aba fechada.
        </p>
      </div>

      <Suspense fallback={<Skeleton className="h-48 w-full" />}>
        <Conteudo instanceId={instance.id} />
      </Suspense>
    </div>
  )
}
