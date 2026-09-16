import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { StatsCard } from '@/components/admin/stats-card'
import { InstanceTable } from '@/components/admin/instance-table'
import { InstanceStatusLive } from '@/components/admin/instance-status-live'
import { SyncInstancesButton } from '@/app/(admin)/instances/sync-button'
import { Skeleton } from '@/components/ui/skeleton'
import { AiCostsSection } from '@/components/admin/ai-costs-section'
import { parsePeriod } from '@/lib/ai-costs-period'
import {
  Smartphone,
  CheckCircle,
  XCircle,
  Users,
} from 'lucide-react'

async function DashboardStats() {
  const supabase = await createClient()

  const { count: totalInstances } = await supabase
    .from('instances')
    .select('*', { count: 'exact', head: true })
    .eq('active', true)

  const { count: connectedInstances } = await supabase
    .from('instances')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'connected')
    .eq('active', true)

  const { count: disconnectedInstances } = await supabase
    .from('instances')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'disconnected')
    .eq('active', true)

  const { count: totalClients } = await supabase
    .from('clients')
    .select('*', { count: 'exact', head: true })
    .eq('active', true)

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatsCard
        title="Total de instâncias"
        value={totalInstances ?? 0}
        icon={Smartphone}
      />
      <StatsCard
        title="Conectadas"
        value={connectedInstances ?? 0}
        icon={CheckCircle}
        variant="success"
      />
      <StatsCard
        title="Desconectadas"
        value={disconnectedInstances ?? 0}
        icon={XCircle}
        variant="destructive"
      />
      <StatsCard
        title="Total de clientes"
        value={totalClients ?? 0}
        icon={Users}
      />
    </div>
  )
}

function StatsLoading() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-32" />
      ))}
    </div>
  )
}

async function RecentInstances() {
  const supabase = await createClient()

  const { data: instances } = await supabase
    .from('instances')
    .select(`
      *,
      client:clients(id, name)
    `)
    .eq('active', true)
    .order('updated_at', { ascending: false })
    .limit(10)

  return <InstanceTable instances={instances ?? []} />
}

function TableLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  )
}

function CostsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-12 w-full" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const period = parsePeriod((await searchParams).gastos)

  return (
    <div className="space-y-6">
      {/*
        Invisible Realtime subscriber — listens to changes in the `instances` table
        and calls router.refresh() so stats and table update automatically
        whenever the DB status changes (e.g. after a sync or webhook event).
      */}
      <InstanceStatusLive />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Painel</h1>
          <p className="text-muted-foreground">
            Visão geral das suas instâncias WhatsApp
          </p>
        </div>
        {/* Sync available directly from dashboard — status updates propagate via Realtime */}
        <SyncInstancesButton />
      </div>

      <Suspense fallback={<StatsLoading />}>
        <DashboardStats />
      </Suspense>

      {/* key pelo periodo: ao trocar o filtro o esqueleto aparece em vez de
          manter os numeros do periodo anterior na tela enquanto carrega */}
      <Suspense key={period} fallback={<CostsLoading />}>
        <AiCostsSection period={period} />
      </Suspense>

      <div>
        <h2 className="text-xl font-semibold mb-4">Instâncias recentes</h2>
        <Suspense fallback={<TableLoading />}>
          <RecentInstances />
        </Suspense>
      </div>
    </div>
  )
}
