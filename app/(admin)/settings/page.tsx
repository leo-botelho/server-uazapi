import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Settings, ExternalLink, Info, Globe } from 'lucide-react'
import { GlobalWebhookForm } from './global-webhook-form'

function maskValue(value: string | undefined): string {
  if (!value) return '(não definido)'
  if (value.length <= 8) return '****'
  return value.slice(0, 4) + '****' + value.slice(-4)
}

export default function SettingsPage() {
  const uazapiBaseUrl = process.env.UAZAPI_BASE_URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="size-6 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
          <p className="text-muted-foreground">
            Configuração da aplicação e variáveis de ambiente
          </p>
        </div>
      </div>

      {/* Webhook Global */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="size-5 text-muted-foreground" />
            <CardTitle>Webhook Global do Servidor</CardTitle>
          </div>
          <CardDescription>
            Configure uma única URL que receberá eventos de <strong>todas as instâncias</strong> sem
            alterar os webhooks individuais dos agentes de IA. Use o evento{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">connection</code>{' '}
            para monitorar desconexões.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GlobalWebhookForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Variáveis de ambiente</CardTitle>
          <CardDescription>
            Configure esses valores no seu arquivo{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
              .env.local
            </code>
            . Reinicie o servidor após alterações.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Variável
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Valor atual
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[
                    {
                      name: 'NEXT_PUBLIC_SUPABASE_URL',
                      value: supabaseUrl,
                      public: true,
                    },
                    {
                      name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
                      value: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
                      public: true,
                    },
                    {
                      name: 'SUPABASE_SERVICE_ROLE_KEY',
                      value: process.env.SUPABASE_SERVICE_ROLE_KEY,
                      public: false,
                    },
                    {
                      name: 'UAZAPI_BASE_URL',
                      value: uazapiBaseUrl,
                      public: false,
                    },
                    {
                      name: 'UAZAPI_ADMIN_TOKEN',
                      value: process.env.UAZAPI_ADMIN_TOKEN,
                      public: false,
                    },
                  ].map(({ name, value, public: isPublic }) => (
                    <tr key={name}>
                      <td className="px-4 py-3">
                        <code className="font-mono text-xs">{name}</code>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {isPublic && value
                          ? value.slice(0, 40) + (value.length > 40 ? '...' : '')
                          : maskValue(value)}
                      </td>
                      <td className="px-4 py-3">
                        {value ? (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                            <span className="size-1.5 rounded-full bg-green-600 dark:bg-green-400" />
                            Definido
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                            <span className="size-1.5 rounded-full bg-red-600 dark:bg-red-400" />
                            Ausente
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400">
              <Info className="size-4 mt-0.5 shrink-0" />
              <p>
                Copie{' '}
                <code className="font-mono text-xs">.env.local.example</code> para{' '}
                <code className="font-mono text-xs">.env.local</code> e preencha os valores. Nunca faça commit de{' '}
                <code className="font-mono text-xs">.env.local</code> no controle de versão.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Projeto Supabase</CardTitle>
            <CardDescription>
              Gerencie seu banco de dados, autenticação e armazenamento
            </CardDescription>
          </CardHeader>
          <CardContent>
            {supabaseUrl ? (
              <a
                href={supabaseUrl.replace('.supabase.co', '.supabase.co/dashboard')}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" />
                Abrir Supabase Dashboard
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">
                Defina{' '}
                <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code>{' '}
                para acessar seu painel.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>UAZAPI Base URL</CardTitle>
            <CardDescription>Endpoint do servidor uazapiGO</CardDescription>
          </CardHeader>
          <CardContent>
            {uazapiBaseUrl ? (
              <code className="font-mono text-sm text-muted-foreground">
                {uazapiBaseUrl}
              </code>
            ) : (
              <p className="text-sm text-muted-foreground">
                Defina{' '}
                <code className="font-mono text-xs">UAZAPI_BASE_URL</code> em{' '}
                <code className="font-mono text-xs">.env.local</code>.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
