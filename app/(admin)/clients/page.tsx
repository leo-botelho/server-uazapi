import { Suspense } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Plus, ExternalLink, Users } from 'lucide-react'

type ClientWithInstanceCount = {
  id: string
  name: string
  email: string | null
  phones: string[]
  active: boolean
  created_at: string
  updated_at: string
  instances: { count: number }[]
}

async function ClientsList() {
  const supabase = await createClient()

  const { data: clients } = await supabase
    .from('clients')
    .select(`
      *,
      instances:instances(count)
    `)
    .eq('active', true)
    .order('created_at', { ascending: false })

  const typedClients = (clients ?? []) as unknown as ClientWithInstanceCount[]

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Phones</TableHead>
          <TableHead>Instances</TableHead>
          <TableHead>Created</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {typedClients.map((client) => {
          const instanceCount = client.instances?.[0]?.count ?? 0
          const phonesDisplay =
            client.phones?.length > 0
              ? client.phones.slice(0, 2).join(', ') +
                (client.phones.length > 2
                  ? ` +${client.phones.length - 2} more`
                  : '')
              : '—'

          return (
            <TableRow key={client.id}>
              <TableCell className="font-medium">
                <Link
                  href={`/clients/${client.id}`}
                  className="hover:underline"
                >
                  {client.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {client.email ?? '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {phonesDisplay}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{instanceCount}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">
                {new Date(client.created_at).toLocaleDateString('pt-BR')}
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="ghost" render={<Link href={`/clients/${client.id}`} />} className="gap-1">
                  <ExternalLink className="size-3" />
                  View
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
        {typedClients.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={6}
              className="py-8 text-center text-muted-foreground"
            >
              No clients found. Create your first client to get started.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}

function TableLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  )
}

export default function ClientsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="size-6 text-muted-foreground" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Clients</h1>
            <p className="text-muted-foreground">
              Manage your clients and their WhatsApp instances
            </p>
          </div>
        </div>
        <Button render={<Link href="/clients/new" />}>
          <Plus className="mr-2 size-4" />
          New Client
        </Button>
      </div>

      <Suspense fallback={<TableLoading />}>
        <ClientsList />
      </Suspense>
    </div>
  )
}
