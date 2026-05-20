'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Power, PowerOff, Key, Loader2, Copy, CheckCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { QrDisplay } from '@/components/client/qr-display'
import { PairingCodeDisplay } from '@/components/client/pairing-code-display'
import { ConnectionStatus } from '@/components/client/connection-status'

type InstanceStatus = 'connected' | 'disconnected' | 'connecting'
type ConnectMethod = 'qr' | 'pairing'

interface InstanceConnectActionsProps {
  instanceId: string
  currentStatus: InstanceStatus
  uazapiToken: string
}

interface ReconnectTokenResponse {
  token: string
  expiresAt: string
}

export function InstanceConnectActions({
  instanceId,
  currentStatus,
  uazapiToken,
}: InstanceConnectActionsProps) {
  const router = useRouter()
  const [connectMethod, setConnectMethod] = useState<ConnectMethod | null>(null)
  const [reconnectToken, setReconnectToken] = useState<string | null>(null)
  const [tokenCopied, setTokenCopied] = useState(false)
  const [isDisconnecting, startDisconnect] = useTransition()
  const [isGeneratingToken, startGenerateToken] = useTransition()

  async function handleDisconnect() {
    startDisconnect(async () => {
      try {
        const res = await fetch(`/api/instances/${instanceId}/disconnect`, {
          method: 'POST',
        })
        if (!res.ok) {
          const body = (await res.json()) as { error?: string }
          throw new Error(body.error ?? 'Failed to disconnect')
        }
        toast.success('Instance disconnected')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to disconnect')
      }
    })
  }

  async function handleGenerateToken() {
    startGenerateToken(async () => {
      try {
        const res = await fetch(`/api/instances/${instanceId}/reconnect-token`, {
          method: 'POST',
        })
        if (!res.ok) {
          const body = (await res.json()) as { error?: string }
          throw new Error(body.error ?? 'Failed to generate token')
        }
        const data = (await res.json()) as ReconnectTokenResponse
        setReconnectToken(data.token)
        toast.success('Reconnect token generated')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to generate token')
      }
    })
  }

  async function copyToken() {
    if (!reconnectToken) return
    await navigator.clipboard.writeText(reconnectToken)
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 2000)
  }

  // If showing a connect method
  if (connectMethod === 'qr') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Scan QR Code</p>
          <Button variant="ghost" size="sm" onClick={() => setConnectMethod(null)}>
            Back
          </Button>
        </div>
        <QrDisplay instanceId={instanceId} uazapiToken={uazapiToken} />
      </div>
    )
  }

  if (connectMethod === 'pairing') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Pairing Code</p>
          <Button variant="ghost" size="sm" onClick={() => setConnectMethod(null)}>
            Back
          </Button>
        </div>
        <PairingCodeDisplay
          instanceId={instanceId}
          uazapiToken={uazapiToken}
          phone=""
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Current status */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Current status</span>
        <ConnectionStatus instanceId={instanceId} initialStatus={currentStatus} />
      </div>

      {/* Connect / Disconnect actions */}
      <div className="flex flex-wrap gap-3">
        {currentStatus !== 'connected' && (
          <>
            <Button
              onClick={() => setConnectMethod('qr')}
              className="gap-2"
            >
              <Power className="size-4" />
              Connect via QR Code
            </Button>
            <Button
              variant="outline"
              onClick={() => setConnectMethod('pairing')}
              className="gap-2"
            >
              <Key className="size-4" />
              Connect via Pairing Code
            </Button>
          </>
        )}

        {currentStatus === 'connected' && (
          <Button
            variant="destructive"
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            className="gap-2"
          >
            {isDisconnecting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PowerOff className="size-4" />
            )}
            {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        )}
      </div>

      {/* Reconnect token */}
      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-sm font-medium">Reconnect Token</p>
        <p className="text-xs text-muted-foreground">
          Generate a time-limited token that allows the client to reconnect
          without admin access.
        </p>

        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerateToken}
          disabled={isGeneratingToken}
          className="gap-2"
        >
          {isGeneratingToken ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Key className="size-3.5" />
          )}
          {isGeneratingToken ? 'Generating...' : 'Generate Token'}
        </Button>

        {reconnectToken && (
          <div className="flex items-center gap-2 mt-2">
            <code className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 font-mono text-xs break-all">
              {reconnectToken}
            </code>
            <Button
              size="icon"
              variant="outline"
              onClick={copyToken}
              aria-label="Copy token"
              className="shrink-0"
            >
              {tokenCopied ? (
                <CheckCircle className="size-4 text-green-600" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
