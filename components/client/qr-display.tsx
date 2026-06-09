'use client'

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

const QR_TIMEOUT_SECONDS = 120
const POLL_INTERVAL_MS = 3000

interface QrDisplayProps {
  instanceId: string
  uazapiToken: string
}

interface QrResponse {
  qrcode: string   // matches /api/connect/qr response field
  status: string
  error?: string
}

interface StatusResponse {
  status: string
}

type DisplayState = 'loading' | 'qr' | 'expired' | 'connected' | 'error'

export function QrDisplay({ instanceId, uazapiToken }: QrDisplayProps) {
  const [displayState, setDisplayState] = useState<DisplayState>('loading')
  const [qrBase64, setQrBase64] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(QR_TIMEOUT_SECONDS)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const fetchQr = useCallback(async () => {
    setDisplayState('loading')
    setSecondsLeft(QR_TIMEOUT_SECONDS)
    setErrorMessage(null)

    try {
      const res = await fetch('/api/connect/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId, token: uazapiToken }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Erro ao gerar QR code')
      }

      const data = (await res.json()) as QrResponse

      if (data.status === 'connected') {
        setDisplayState('connected')
        return
      }

      if (!data.qrcode) {
        throw new Error('Nenhum QR code retornado pela instância')
      }

      setQrBase64(data.qrcode)
      setDisplayState('qr')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Erro desconhecido')
      setDisplayState('error')
    }
  }, [instanceId, uazapiToken])

  // Busca o QR ao montar
  useEffect(() => {
    fetchQr()
  }, [fetchQr])

  // Contador regressivo
  useEffect(() => {
    if (displayState !== 'qr') return

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval)
          setDisplayState('expired')
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [displayState])

  // Polling de status
  useEffect(() => {
    if (displayState !== 'qr') return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/connect/status?instanceId=${encodeURIComponent(instanceId)}`,
          { cache: 'no-store' }
        )
        if (res.ok) {
          const data = (await res.json()) as StatusResponse
          if (data.status === 'connected') {
            setDisplayState('connected')
          }
        }
      } catch {
        // ignora erros de polling silenciosamente
      }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [displayState, instanceId])

  function formatSeconds(s: number): string {
    const m = Math.floor(s / 60)
    const rem = s % 60
    return `${m}:${rem.toString().padStart(2, '0')}`
  }

  if (displayState === 'loading') {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="size-10 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Gerando QR code…</p>
      </div>
    )
  }

  if (displayState === 'connected') {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <CheckCircle className="size-12 text-green-600" />
        <p className="text-lg font-semibold text-green-700 dark:text-green-400">
          WhatsApp conectado com sucesso!
        </p>
      </div>
    )
  }

  if (displayState === 'expired') {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <p className="text-muted-foreground text-sm">QR code expirado.</p>
        <Button onClick={fetchQr} className="gap-2">
          <RefreshCw className="size-4" />
          Gerar novo QR code
        </Button>
      </div>
    )
  }

  if (displayState === 'error') {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <p className="text-sm text-destructive text-center max-w-sm">{errorMessage}</p>
        <Button onClick={fetchQr} variant="outline" className="gap-2">
          <RefreshCw className="size-4" />
          Tentar novamente
        </Button>
      </div>
    )
  }

  // displayState === 'qr'
  // The uazapiGO API may return qrcode as a full data URL ("data:image/png;base64,...")
  // or as raw base64. Normalize to always produce a valid src.
  const qrSrc = qrBase64
    ? qrBase64.startsWith('data:')
      ? qrBase64
      : `data:image/png;base64,${qrBase64}`
    : null

  return (
    <div className="flex flex-col items-center gap-4">
      {qrSrc && (
        <img
          src={qrSrc}
          alt="QR Code do WhatsApp"
          className="size-56 rounded-lg border border-border"
        />
      )}
      <p className="text-sm text-muted-foreground">
        Expira em{' '}
        <span className="font-mono font-semibold text-foreground">
          {formatSeconds(secondsLeft)}
        </span>
      </p>
      <p className="text-xs text-muted-foreground text-center max-w-xs">
        Abra o WhatsApp no celular → Configurações → Aparelhos conectados →
        Conectar aparelho → escaneie este QR code.
      </p>
      <Button onClick={fetchQr} variant="outline" size="sm" className="gap-2">
        <RefreshCw className="size-3.5" />
        Atualizar QR
      </Button>
    </div>
  )
}
