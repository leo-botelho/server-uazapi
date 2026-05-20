import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Settings, ExternalLink, Info } from 'lucide-react'

function maskValue(value: string | undefined): string {
  if (!value) return '(not set)'
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
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Application configuration and environment
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Environment Variables</CardTitle>
          <CardDescription>
            Configure these values in your{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
              .env.local
            </code>{' '}
            file. Restart the server after changes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Variable
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground">
                      Current Value
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
                            Set
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
                            <span className="size-1.5 rounded-full bg-red-600 dark:bg-red-400" />
                            Missing
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
                Copy{' '}
                <code className="font-mono text-xs">.env.local.example</code> to{' '}
                <code className="font-mono text-xs">.env.local</code> and fill in
                your values. Never commit{' '}
                <code className="font-mono text-xs">.env.local</code> to version
                control.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Supabase Project</CardTitle>
            <CardDescription>
              Manage your database, auth, and storage
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
                Open Supabase Dashboard
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">
                Set{' '}
                <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code>{' '}
                to access your dashboard.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>UAZAPI Base URL</CardTitle>
            <CardDescription>The uazapiGO server endpoint</CardDescription>
          </CardHeader>
          <CardContent>
            {uazapiBaseUrl ? (
              <code className="font-mono text-sm text-muted-foreground">
                {uazapiBaseUrl}
              </code>
            ) : (
              <p className="text-sm text-muted-foreground">
                Set{' '}
                <code className="font-mono text-xs">UAZAPI_BASE_URL</code> in{' '}
                <code className="font-mono text-xs">.env.local</code>.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
