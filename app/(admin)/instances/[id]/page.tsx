import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { InstanceStatusBadge } from '@/components/admin/instance-status-badge'
import { InstanceConnectActions } from './connect-actions'
import { LinkClientForm } from './link-client-form'
import { formatDistanceToNow } from 'date-fns'
import { ArrowLeft } from 'lucide-react'
import type { Json } from '@/types/database'

interface InstanceDetailPageProps {
  params: Promise<{ id: string }>
}

function payloadPreview(payload: Json): string {
  try {
    const str = JSON.stringify(payload)
    return str.length > 100 ? str.slice(0, 100) + '...' : str
  } catch {
    return String(payload)
  }
}

export default async function InstanceDetailPage({
  params,
}: InstanceDetailPageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: instance, error } = await supabase
    .from('instances')
    .select(`
      *,
      client:clients(*)
    `)
    .eq('id', id)
    .single()

  if (error || !instance) {
    notFound()
  }

  const { data: recentEvents } = await supabase
    .from('webhook_events')
    .select('*')
    .eq('instance_id', id)
    .order('received_at', { ascending: false })
    .limit(10)

  const { data: allClients } = await supabase
    .from('clients')
    .select('id, name, email')
    .eq('active', true)
    .order('name', { ascending: true })

  const alertChannelLabels: Record<string, string> = {
    email: 'Email',
    whatsapp: 'WhatsApp',
    n8n: 'n8n Webhook',
    none: 'None',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/instances"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            All Instances
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">{instance.name}</h1>
          <p className="text-muted-foreground font-mono text-sm">{instance.id}</p>
        </div>
        <InstanceStatusBadge status={instance.status} />
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="connection">Connection</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Instance Details</CardTitle>
                <CardDescription>
                  Basic information about this instance
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <InstanceStatusBadge status={instance.status} />
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Phone Connected
                  </span>
                  <span className="text-sm font-medium">
                    {instance.phone_connected ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Profile Name
                  </span>
                  <span className="text-sm">{instance.profile_name ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Last Disconnected
                  </span>
                  <span className="text-sm">
                    {instance.last_disconnected_at
                      ? formatDistanceToNow(
                          new Date(instance.last_disconnected_at),
                          { addSuffix: true }
                        )
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Created</span>
                  <span className="text-sm">
                    {new Date(instance.created_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Active</span>
                  <Badge variant={instance.active ? 'default' : 'secondary'}>
                    {instance.active ? 'Yes' : 'No'}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle>Cliente</CardTitle>
                  <CardDescription>Cliente vinculado a esta instância</CardDescription>
                </div>
                <LinkClientForm
                  instanceId={instance.id}
                  currentClientId={instance.client_id}
                  clients={allClients ?? []}
                />
              </CardHeader>
              <CardContent className="space-y-3">
                {instance.client ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Nome</span>
                      <Link
                        href={`/clients/${instance.client.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {instance.client.name}
                      </Link>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Email</span>
                      <span className="text-sm">
                        {instance.client.email ?? '—'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Telefones</span>
                      <span className="text-sm">
                        {instance.client.phones?.join(', ') ?? '—'}
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhum cliente vinculado. Clique em "Vincular cliente" para associar.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Connection */}
        <TabsContent value="connection">
          <Card>
            <CardHeader>
              <CardTitle>Connection Management</CardTitle>
              <CardDescription>
                Connect, disconnect, or generate a reconnect token for this
                instance
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InstanceConnectActions
                instanceId={instance.id}
                currentStatus={instance.status}
                uazapiToken={instance.uazapi_token}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Alerts */}
        <TabsContent value="alerts">
          <Card>
            <CardHeader>
              <CardTitle>Alert Configuration</CardTitle>
              <CardDescription>
                Current alert settings for disconnect notifications
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    Alert Channel
                  </span>
                  <Badge variant="outline">
                    {alertChannelLabels[instance.alert_channel] ??
                      instance.alert_channel}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    Silence Window
                  </span>
                  <span className="text-sm font-medium">
                    {instance.silence_start}h &ndash; {instance.silence_end}h
                  </span>
                </div>
                {instance.alert_config &&
                  typeof instance.alert_config === 'object' &&
                  !Array.isArray(instance.alert_config) && (
                    <div className="space-y-1">
                      <span className="text-sm text-muted-foreground">
                        Alert Config
                      </span>
                      <pre className="rounded-lg bg-muted p-3 text-xs font-mono overflow-x-auto">
                        {JSON.stringify(instance.alert_config, null, 2)}
                      </pre>
                    </div>
                  )}
              </div>
              <p className="text-xs text-muted-foreground">
                Alert configuration editing coming soon.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs */}
        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle>Recent Webhook Events</CardTitle>
              <CardDescription>
                Last 10 webhook events received for this instance
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentEvents && recentEvents.length > 0 ? (
                <div className="space-y-2">
                  {recentEvents.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-lg border border-border bg-muted/30 p-3 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className="font-mono text-xs">
                          {event.event_type}
                        </Badge>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(new Date(event.received_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                      <code className="block text-xs text-muted-foreground break-all">
                        {payloadPreview(event.payload)}
                      </code>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No webhook events received for this instance yet.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
