import { Suspense } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { InstanceTable } from '@/components/admin/instance-table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Plus } from 'lucide-react'

async function InstancesList() {
  const supabase = await createClient()

  const { data: instances } = await supabase
    .from('instances')
    .select(`
      *,
      client:clients(id, name)
    `)
    .eq('active', true)
    .order('created_at', { ascending: false })

  return <InstanceTable instances={instances ?? []} />
}

function TableLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  )
}

export default function InstancesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Instances</h1>
          <p className="text-muted-foreground">
            Manage your WhatsApp instances
          </p>
        </div>
        <Button render={<Link href="/instances/new" />}>
          <Plus className="mr-2 h-4 w-4" />
          New Instance
        </Button>
      </div>

      <Suspense fallback={<TableLoading />}>
        <InstancesList />
      </Suspense>
    </div>
  )
}
