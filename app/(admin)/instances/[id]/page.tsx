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
import { AlertConfigForm } from './alert-config-form'
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

  // Sender instances for WhatsApp alert (all connected instances except this one)
  const { data: senderInstances } = await supabase
    .from('instances')
    .select('id, name, phone_connected')
    .eq('active', true)
    .neq('id', id)
    .order('name', { ascending: true })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Link
            href="/instances"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Todas as instâncias
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">{instance.name}</h1>
          <p className="text-muted-foreground font-mono text-sm">{instance.id}</p>
        </div>
        <InstanceStatusBadge status={instance.status} />
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="connection">Conexão</TabsTrigger>
          <TabsTrigger value="alerts">Alertas</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Detalhes da instância</CardTitle>
                <CardDescription>
                  Informações básicas sobre esta instância
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <InstanceStatusBadge status={instance.status} />
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Telefone conectado
                  </span>
                  <span className="text-sm font-medium">
                    {instance.phone_connected ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Nome do perfil
                  </span>
                  <span className="text-sm">{instance.profile_name ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">
                    Última desconexão
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
                  <span className="text-sm text-muted-foreground">Criado em</span>
                  <span className="text-sm">
                    {new Date(instance.created_at).toLocaleDateString('pt-BR')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Ativo</span>
                  <Badge variant={instance.active ? 'default' : 'secondary'}>
                    {instance.active ? 'Sim' : 'Não'}
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
              <CardTitle>Gerenciamento de conexão</CardTitle>
              <CardDescription>
                Conecte, desconecte ou gere um token de reconexão para esta instância
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
              <CardTitle>Alertas de desconexão</CardTitle>
              <CardDescription>
                Configure como e quando notificar quando esta instância desconectar
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AlertConfigForm
                instanceId={instance.id}
                current={{
                  alertChannel: instance.alert_channel ?? 'none',
                  alertConfig: (instance.alert_config as Record<string, unknown>) ?? {},
                  silenceStart: instance.silence_start ?? 23,
                  silenceEnd: instance.silence_end ?? 7,
                }}
                senderInstances={senderInstances ?? []}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs */}
        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle>Eventos de webhook recentes</CardTitle>
              <CardDescription>
                Últimos 10 eventos de webhook recebidos por esta instância
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
                  Nenhum evento de webhook recebido por esta instância ainda.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
