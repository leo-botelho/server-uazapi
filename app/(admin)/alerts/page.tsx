import { Suspense } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Bell, ExternalLink } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

async function RecentNotifications() {
  const supabase = await createClient()

  const { data: logs } = await supabase
    .from('notifications_log')
    .select(`
      *,
      instance:instances(id, name)
    `)
    .order('created_at', { ascending: false })
    .limit(50)

  if (!logs?.length) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        No notifications sent yet.
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Instance</TableHead>
          <TableHead>Channel</TableHead>
          <TableHead>Recipient</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Sent</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => (
          <TableRow key={log.id}>
            <TableCell className="font-medium">
              {log.instance ? (
                <Link
                  href={`/instances/${log.instance.id}`}
                  className="hover:underline flex items-center gap-1"
                >
                  {log.instance.name}
                  <ExternalLink className="size-3 text-muted-foreground" />
                </Link>
              ) : (
                '—'
              )}
            </TableCell>
            <TableCell>
              <Badge variant="outline" className="capitalize">
                {log.channel}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {log.recipient ?? '—'}
            </TableCell>
            <TableCell>
              <Badge
                variant={
                  log.status === 'sent'
                    ? 'default'
                    : log.status === 'failed'
                    ? 'destructive'
                    : 'secondary'
                }
                className="capitalize"
              >
                {log.status}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              {log.sent_at
                ? formatDistanceToNow(new Date(log.sent_at), { addSuffix: true })
                : formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function NotificationsLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-10 w-full" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}

export default function AlertsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Bell className="size-6 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Alerts</h1>
          <p className="text-muted-foreground">
            Disconnect notifications and alert history
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Alert Configuration</CardTitle>
          <CardDescription>
            Alert channels are configured per-instance. Go to an instance to
            set up email, WhatsApp, or n8n webhook notifications.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/instances"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" />
            Manage Instances
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Notifications</CardTitle>
          <CardDescription>
            Last 50 alert notifications sent across all instances
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<NotificationsLoading />}>
            <RecentNotifications />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  )
}
