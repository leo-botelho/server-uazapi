import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { StatsCard } from '@/components/admin/stats-card'
import { InstanceTable } from '@/components/admin/instance-table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Smartphone,
  CheckCircle,
  XCircle,
  AlertTriangle,
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
        icon={AlertTriangle}
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

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Painel</h1>
        <p className="text-muted-foreground">
          Visão geral das suas instâncias WhatsApp
        </p>
      </div>

      <Suspense fallback={<StatsLoading />}>
        <DashboardStats />
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
