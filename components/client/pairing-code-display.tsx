'use client'

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, RefreshCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

const PAIRING_TIMEOUT_SECONDS = 300
const POLL_INTERVAL_MS = 3000

interface PairingCodeDisplayProps {
  instanceId: string
  uazapiToken: string
  phone: string
}

interface PairingResponse {
  code: string
  error?: string
}

interface StatusResponse {
  status: string
}

type DisplayState = 'loading' | 'code' | 'expired' | 'connected' | 'error'

function formatPairingCode(code: string): string {
  const digits = code.replace(/\D/g, '')
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`
  }
  return code
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${m}:${rem.toString().padStart(2, '0')}`
}

export function PairingCodeDisplay({ instanceId, uazapiToken, phone }: PairingCodeDisplayProps) {
  const [displayState, setDisplayState] = useState<DisplayState>('loading')
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(PAIRING_TIMEOUT_SECONDS)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const fetchPairingCode = useCallback(async () => {
    setDisplayState('loading')
    setSecondsLeft(PAIRING_TIMEOUT_SECONDS)
    setErrorMessage(null)

    try {
      const res = await fetch('/api/connect/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId, token: uazapiToken, phone }),
      })

      if (!res.ok) {
        const body = (await res.json()) as { error?: string }
        throw new Error(body.error ?? 'Failed to get pairing code')
      }

      const data = (await res.json()) as PairingResponse
      setPairingCode(data.code)
      setDisplayState('code')
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error')
      setDisplayState('error')
    }
  }, [instanceId, uazapiToken, phone])

  // Fetch on mount
  useEffect(() => {
    fetchPairingCode()
  }, [fetchPairingCode])

  // Countdown
  useEffect(() => {
    if (displayState !== 'code') return

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

  // Poll status
  useEffect(() => {
    if (displayState !== 'code') return

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
        // silently ignore
      }
    }, POLL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [displayState, instanceId])

  if (displayState === 'loading') {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="size-10 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Generating pairing code...</p>
      </div>
    )
  }

  if (displayState === 'connected') {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <CheckCircle className="size-12 text-green-600" />
        <p className="text-lg font-semibold text-green-700 dark:text-green-400">
          WhatsApp connected successfully!
        </p>
      </div>
    )
  }

  if (displayState === 'expired') {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <p className="text-muted-foreground text-sm">Pairing code expired.</p>
        <Button onClick={fetchPairingCode} className="gap-2">
          <RefreshCw className="size-4" />
          Get New Pairing Code
        </Button>
      </div>
    )
  }

  if (displayState === 'error') {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <p className="text-sm text-destructive">{errorMessage}</p>
        <Button onClick={fetchPairingCode} variant="outline" className="gap-2">
          <RefreshCw className="size-4" />
          Try Again
        </Button>
      </div>
    )
  }

  // displayState === 'code'
  return (
    <div className="flex flex-col items-center gap-6">
      {pairingCode && (
        <div className="rounded-xl border border-border bg-muted px-8 py-6">
          <p className="font-mono text-4xl font-bold tracking-widest text-foreground">
            {formatPairingCode(pairingCode)}
          </p>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Expires in{' '}
        <span className="font-mono font-semibold text-foreground">
          {formatSeconds(secondsLeft)}
        </span>
      </p>

      <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm text-muted-foreground space-y-1 max-w-sm">
        <p className="font-semibold text-foreground">How to connect:</p>
        <ol className="list-decimal list-inside space-y-1">
          <li>Open WhatsApp on your phone</li>
          <li>Go to Settings</li>
          <li>Tap Linked Devices</li>
          <li>Tap Link with phone number</li>
          <li>Enter the code above</li>
        </ol>
      </div>

      <Button onClick={fetchPairingCode} variant="outline" size="sm" className="gap-2">
        <RefreshCw className="size-3.5" />
        Refresh Code
      </Button>
    </div>
  )
}
