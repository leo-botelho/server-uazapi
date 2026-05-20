import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ServerForm } from './server-form'
import { Globe } from 'lucide-react'

async function ServersList() {
  const supabase = await createClient()

  const { data: servers } = await supabase
    .from('servers')
    .select('id, name, url, active, created_at')
    .order('created_at', { ascending: false })

  if (!servers || servers.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          Nenhum servidor cadastrado ainda. Adicione um servidor abaixo.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {servers.map((server) => (
        <Card key={server.id}>
          <CardContent className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <Globe className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">{server.name}</p>
                <p className="text-sm text-muted-foreground">{server.url}</p>
              </div>
            </div>
            <Badge variant={server.active ? 'default' : 'secondary'}>
              {server.active ? 'Ativo' : 'Inativo'}
            </Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

export default function ServersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Servidores uazapiGO</h1>
        <p className="text-muted-foreground">
          Gerencie as URLs e tokens dos seus servidores uazapiGO. Cada instância pode ser vinculada a um servidor diferente.
        </p>
      </div>

      <ServersList />

      <Card>
        <CardHeader>
          <CardTitle>Adicionar servidor</CardTitle>
          <CardDescription>
            Informe a URL completa do servidor e o admintoken do uazapiGO.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ServerForm />
        </CardContent>
      </Card>
    </div>
  )
}
