import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { InstanceTable } from '@/components/admin/instance-table'
import { ClientProxyForm } from '@/components/admin/client-proxy-form'

interface ClientDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function ClientDetailPage({ params }: ClientDetailPageProps) {
  const { id } = await params
  const supabase = await createClient()

  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !client) {
    notFound()
  }

  const { data: instances } = await supabase
    .from('instances')
    .select('*, client:clients(id, name)')
    .eq('client_id', id)
    .eq('active', true)
    .order('created_at', { ascending: false })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{client.name}</h1>
          <p className="text-muted-foreground">
            ID do cliente: {client.id}
          </p>
        </div>
        <Badge variant={client.active ? 'default' : 'secondary'}>
          {client.active ? 'Ativo' : 'Inativo'}
        </Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Informações de contato</CardTitle>
            <CardDescription>Dados de contato do cliente</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">E-mail</span>
              <span>{client.email ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Telefones</span>
              <span>{client.phones?.join(', ') ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Criado em</span>
              <span>{new Date(client.created_at).toLocaleDateString('pt-BR')}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estatísticas</CardTitle>
            <CardDescription>Visão geral das instâncias</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total de instâncias</span>
              <span>{instances?.length ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Conectadas</span>
              <span>
                {instances?.filter((i) => i.status === 'connected').length ?? 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Desconectadas</span>
              <span>
                {instances?.filter((i) => i.status === 'disconnected').length ?? 0}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Proxy de conexão */}
      <Card>
        <CardHeader>
          <CardTitle>Proxy de Conexão</CardTitle>
          <CardDescription>
            Cidade usada para o proxy gerenciado do uazapiGO — aplicado automaticamente em toda reconexão
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ClientProxyForm
            clientId={client.id}
            initialCity={client.proxy_city ?? null}
            initialState={client.proxy_state ?? null}
          />
        </CardContent>
      </Card>

      <div>
        <h2 className="text-xl font-semibold mb-4">Instâncias</h2>
        <InstanceTable instances={instances ?? []} />
      </div>
    </div>
  )
}
