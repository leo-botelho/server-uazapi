'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Power, PowerOff, Key, Loader2, Copy, CheckCircle, RotateCcw } from 'lucide-react'

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
  const [isResetting, startReset] = useTransition()
  const [isGeneratingToken, startGenerateToken] = useTransition()

  async function handleDisconnect() {
    startDisconnect(async () => {
      try {
        const res = await fetch(`/api/instances/${instanceId}/disconnect`, {
          method: 'POST',
        })
        if (!res.ok) {
          const body = (await res.json()) as { error?: string }
          throw new Error(body.error ?? 'Falha ao desconectar')
        }
        toast.success('Instância desconectada')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Falha ao desconectar')
      }
    })
  }

  async function handleReset() {
    startReset(async () => {
      try {
        const res = await fetch(`/api/instances/${instanceId}/reset`, { method: 'POST' })
        if (!res.ok) {
          const body = (await res.json()) as { error?: string }
          throw new Error(body.error ?? 'Falha ao reiniciar')
        }
        toast.success('Runtime reiniciado com sucesso')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Falha ao reiniciar runtime')
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
          throw new Error(body.error ?? 'Falha ao gerar token')
        }
        const data = (await res.json()) as ReconnectTokenResponse
        setReconnectToken(data.token)
        toast.success('Token de reconexão gerado')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Falha ao gerar token')
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
          <p className="text-sm font-medium">Escanear QR Code</p>
          <Button variant="ghost" size="sm" onClick={() => setConnectMethod(null)}>
            Voltar
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
          <p className="text-sm font-medium">Código de pareamento</p>
          <Button variant="ghost" size="sm" onClick={() => setConnectMethod(null)}>
            Voltar
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
        <span className="text-sm text-muted-foreground">Status atual</span>
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
              Conectar via QR Code
            </Button>
            <Button
              variant="outline"
              onClick={() => setConnectMethod('pairing')}
              className="gap-2"
            >
              <Key className="size-4" />
              Conectar via código de pareamento
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
            {isDisconnecting ? 'Desconectando...' : 'Desconectar'}
          </Button>
        )}

        {/* Reset runtime — available in any state */}
        <Button
          variant="outline"
          onClick={handleReset}
          disabled={isResetting}
          className="gap-2"
          title="Reinicia o runtime sem desconectar a sessão. Útil quando a instância trava."
        >
          {isResetting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RotateCcw className="size-4" />
          )}
          {isResetting ? 'Reiniciando...' : 'Reset runtime'}
        </Button>
      </div>

      {/* Reconnect token */}
      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-sm font-medium">Token de reconexão</p>
        <p className="text-xs text-muted-foreground">
          Gera um token com validade limitada que permite ao cliente reconectar sem acesso de administrador.
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
          {isGeneratingToken ? 'Gerando...' : 'Gerar token'}
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
              aria-label="Copiar token"
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
