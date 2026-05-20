import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConnectionStatus } from '@/components/client/connection-status'
import { QrDisplay } from '@/components/client/qr-display'

interface ReconnectPageProps {
  params: Promise<{ token: string }>
}

export default async function ReconnectPage({ params }: ReconnectPageProps) {
  const { token } = await params

  // Use service client to bypass RLS for public tokens
  const supabase = await createServiceClient()

  // Find the reconnect token
  const { data: reconnectToken, error } = await supabase
    .from('reconnect_tokens')
    .select(`
      *,
      instance:instances(
        id,
        name,
        status,
        uazapi_token,
        phone_connected,
        profile_name
      )
    `)
    .eq('token', token)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .single()

  if (error || !reconnectToken || !reconnectToken.instance) {
    notFound()
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-muted/50">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Reconectar WhatsApp</CardTitle>
          <CardDescription>
            Reconecte sua instância WhatsApp: {reconnectToken.instance.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ConnectionStatus
            instanceId={reconnectToken.instance.id}
            initialStatus={reconnectToken.instance.status}
          />

          {reconnectToken.instance.status !== 'connected' && (
            <QrDisplay
              instanceId={reconnectToken.instance.id}
              uazapiToken={reconnectToken.instance.uazapi_token}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
