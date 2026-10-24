import { Suspense } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'

import { NovoGrupo } from './novo-grupo'
import { MigrationPending } from '@/components/admin/groups/migration-pending'
import { Skeleton } from '@/components/ui/skeleton'
import { listarGruposEmCache } from '@/lib/groups/cache'
import { verificarInstalacaoDeGrupos } from '@/lib/groups/install'
import { createClient } from '@/lib/supabase/server'

async function Conteudo({ instanceId }: { instanceId: string }) {
  const instalacao = await verificarInstalacaoDeGrupos()
  if (instalacao.estado === 'pendente') return <MigrationPending detalhe={instalacao.detalhe} />

  const todos = await listarGruposEmCache(instanceId)

  // Comunidade é "grupo pai" no cache. Os grupos comuns são o que dá para vincular a ela.
  const comunidades = todos.filter((g) => g.is_parent).map((g) => ({ jid: g.group_jid, nome: g.name ?? g.group_jid }))
  const grupos = todos.filter((g) => !g.is_parent).map((g) => ({ jid: g.group_jid, nome: g.name ?? g.group_jid }))

  return <NovoGrupo instanceId={instanceId} comunidades={comunidades} grupos={grupos} />
}

export default async function NovoGrupoPage({ params }: { params: Promise<{ instanceId: string }> }) {
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
        <h1 className="text-3xl font-bold tracking-tight">Criar, entrar e comunidades</h1>
        <p className="text-sm text-muted-foreground">
          Ações que mexem com gente: cada uma pede confirmação e é registrada no log.
        </p>
      </div>

      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <Conteudo instanceId={instance.id} />
      </Suspense>
    </div>
  )
}
