import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { LiveMonitor } from '@/components/admin/live-monitor'
import { ScrollText } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { Json } from '@/types/database'

const PAGE_SIZE = 20

interface EventLogsListProps {
  page: number
}

function payloadPreview(payload: Json): string {
  try {
    const str = JSON.stringify(payload)
    return str.length > 100 ? str.slice(0, 100) + '...' : str
  } catch {
    return String(payload)
  }
}

async function EventLogsList({ page }: EventLogsListProps) {
  const supabase = await createClient()
  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  const { data: events, count } = await supabase
    .from('webhook_events')
    .select(`
      *,
      instance:instances(id, name)
    `, { count: 'exact' })
    .order('received_at', { ascending: false })
    .range(from, to)

  const totalPages = count ? Math.ceil(count / PAGE_SIZE) : 0

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Event Type</TableHead>
            <TableHead>Instance</TableHead>
            <TableHead>Received</TableHead>
            <TableHead>Payload Preview</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events?.map((event) => (
            <TableRow key={event.id}>
              <TableCell>
                <Badge variant="outline" className="font-mono text-xs">
                  {event.event_type}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {event.instance?.name ?? '—'}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDistanceToNow(new Date(event.received_at), {
                  addSuffix: true,
                })}
              </TableCell>
              <TableCell className="max-w-sm">
                <code className="text-xs text-muted-foreground break-all">
                  {payloadPreview(event.payload)}
                </code>
              </TableCell>
            </TableRow>
          ))}
          {!events?.length && (
            <TableRow>
              <TableCell
                colSpan={4}
                className="py-8 text-center text-muted-foreground"
              >
                No webhook events logged yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <p className="text-xs text-muted-foreground text-right">
          Page {page + 1} of {totalPages} &bull; {count} total events
        </p>
      )}
    </div>
  )
}

function TableLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: PAGE_SIZE }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

interface LogsPageProps {
  searchParams: Promise<{ page?: string }>
}

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const params = await searchParams
  const page = Math.max(0, parseInt(params.page ?? '0', 10))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ScrollText className="size-6 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Webhook Event Logs</h1>
          <p className="text-muted-foreground">
            Incoming webhook events from uazapiGO — {PAGE_SIZE} per page
          </p>
        </div>
      </div>

      {/* Live monitor */}
      <Card>
        <CardHeader>
          <CardTitle>Monitor ao vivo</CardTitle>
          <CardDescription>
            Eventos chegando em tempo real via Supabase Realtime — sem precisar atualizar a página
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LiveMonitor />
        </CardContent>
      </Card>

      {/* Historical log */}
      <Card>
        <CardHeader>
          <CardTitle>Histórico de eventos</CardTitle>
          <CardDescription>
            Todos os eventos recebidos do uazapiGO — {PAGE_SIZE} por página
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<TableLoading />}>
            <EventLogsList page={page} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  )
}
