import { Suspense } from 'react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft, ShieldAlert } from 'lucide-react'

import { GroupManager } from './group-manager'
import { MigrationPending } from '@/components/admin/groups/migration-pending'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { verificarInstalacaoDeGrupos } from '@/lib/groups/install'
import { createClient, createServiceClient } from '@/lib/supabase/server'

/**
 * Na URL o grupo vai SEM o `@g.us`: o `@` precisa de codificação na URL e é
 * fácil de errar. Só dígitos e hífen, o que também fecha a porta para qualquer
 * outra coisa entrar por esse segmento.
 */
const SEGMENTO_VALIDO = /^[0-9-]+$/

async function Conteudo({ instanceId, grupo }: { instanceId: string; grupo: string }) {
  const instalacao = await verificarInstalacaoDeGrupos()
  if (instalacao.estado === 'pendente') return <MigrationPending detalhe={instalacao.detalhe} />

  const groupjid = `${grupo}@g.us`

  const supabase = await createClient()
  const { data: instance } = await supabase
    .from('instances')
    .select('id, name')
    .eq('id', instanceId)
    .eq('active', true)
    .maybeSingle()

  if (!instance) notFound()

  // O cache só é legível pela service role; o login já foi conferido na página.
  const db = await createServiceClient()
  const { data: linha } = await db
    .from('group_cache')
    .select('name, owner_is_admin')
    .eq('instance_id', instanceId)
    .eq('group_jid', groupjid)
    .maybeSingle()

  if (!linha) notFound()

  const nome = linha.name ?? groupjid

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/groups/${instanceId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {instance.name}
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">{nome}</h1>
      </div>

      {!linha.owner_is_admin && (
        <Alert className="border-amber-500/40">
          <ShieldAlert className="text-amber-400" aria-hidden />
          <AlertDescription>
            O número conectado não é admin deste grupo (segundo a última lista). Você pode ver tudo,
            mas as edições ficam travadas. Se acabou de virar admin, volte e use “Atualizar lista”.
          </AlertDescription>
        </Alert>
      )}

      <GroupManager
        instanceId={instanceId}
        groupjid={groupjid}
        nomeInicial={nome}
        souAdminNoCache={linha.owner_is_admin}
      />
    </div>
  )
}

export default async function GrupoPage({
  params,
}: {
  params: Promise<{ instanceId: string; grupo: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { instanceId, grupo } = await params
  if (!SEGMENTO_VALIDO.test(grupo)) notFound()

  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Conteudo instanceId={instanceId} grupo={grupo} />
    </Suspense>
  )
}
