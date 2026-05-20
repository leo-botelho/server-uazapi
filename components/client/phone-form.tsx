'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Smartphone, QrCode, Hash } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QrDisplay } from './qr-display'
import { PairingCodeDisplay } from './pairing-code-display'
import { ConnectionStatus } from './connection-status'
import { cn } from '@/lib/utils'

const phoneSchema = z.object({
  phone: z
    .string()
    .min(10, 'Digite ao menos 10 dígitos')
    .max(13, 'Digite no máximo 13 dígitos')
    .regex(/^\d+$/, 'Digite apenas números'),
})

type PhoneFormValues = z.infer<typeof phoneSchema>

interface LookupResult {
  instanceId: string
  instanceName: string
  status: 'connected' | 'disconnected' | 'connecting'
  uazapiToken: string
}

interface LookupErrorResponse {
  error: 'not_found' | string
}

type ConnectMethod = 'qr' | 'pairing'

export function PhoneForm() {
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [connectMethod, setConnectMethod] = useState<ConnectMethod | null>(null)
  const [phone, setPhone] = useState('')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PhoneFormValues>({
    resolver: zodResolver(phoneSchema),
  })

  async function onSubmit(values: PhoneFormValues) {
    setNotFound(false)
    setLookupResult(null)
    setConnectMethod(null)

    try {
      const res = await fetch('/api/connect/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: values.phone }),
      })

      const data = (await res.json()) as LookupResult | LookupErrorResponse

      if (!res.ok || 'error' in data) {
        const err = data as LookupErrorResponse
        if (err.error === 'not_found') {
          setNotFound(true)
        } else {
          setNotFound(true)
        }
        return
      }

      const result = data as LookupResult
      setPhone(values.phone)
      setLookupResult(result)
    } catch {
      setNotFound(true)
    }
  }

  // Show connected state
  if (lookupResult?.status === 'connected') {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
          <p className="font-medium text-green-700 dark:text-green-400">
            {lookupResult.instanceName}
          </p>
          <p className="text-sm text-green-600 dark:text-green-500 mt-1">
            Your WhatsApp is already connected.
          </p>
        </div>
        <ConnectionStatus
          instanceId={lookupResult.instanceId}
          initialStatus={lookupResult.status}
        />
      </div>
    )
  }

  // Show connection options after lookup for disconnected/connecting
  if (lookupResult && (lookupResult.status === 'disconnected' || lookupResult.status === 'connecting')) {
    if (connectMethod === 'qr') {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              Connecting: <span className="text-foreground">{lookupResult.instanceName}</span>
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConnectMethod(null)}
            >
              Back
            </Button>
          </div>
          <QrDisplay
            instanceId={lookupResult.instanceId}
            uazapiToken={lookupResult.uazapiToken}
          />
        </div>
      )
    }

    if (connectMethod === 'pairing') {
      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              Connecting: <span className="text-foreground">{lookupResult.instanceName}</span>
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConnectMethod(null)}
            >
              Back
            </Button>
          </div>
          <PairingCodeDisplay
            instanceId={lookupResult.instanceId}
            uazapiToken={lookupResult.uazapiToken}
            phone={phone}
          />
        </div>
      )
    }

    // Choose method
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-muted/50 p-4">
          <div className="flex items-center gap-2">
            <Smartphone className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium">{lookupResult.instanceName}</p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Instance found. Choose how to connect:
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setConnectMethod('qr')}
            className={cn(
              'flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4',
              'hover:border-primary hover:bg-muted/50 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            <QrCode className="size-8 text-muted-foreground" />
            <span className="text-sm font-medium">QR Code</span>
            <span className="text-xs text-muted-foreground text-center">
              Scan with WhatsApp camera
            </span>
          </button>

          <button
            type="button"
            onClick={() => setConnectMethod('pairing')}
            className={cn(
              'flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4',
              'hover:border-primary hover:bg-muted/50 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            <Hash className="size-8 text-muted-foreground" />
            <span className="text-sm font-medium">Pairing Code</span>
            <span className="text-xs text-muted-foreground text-center">
              Enter code on your phone
            </span>
          </button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => {
            setLookupResult(null)
            setNotFound(false)
          }}
        >
          Search Again
        </Button>
      </div>
    )
  }

  // Phone input form
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="phone">Phone Number</Label>
        <Input
          id="phone"
          type="tel"
          inputMode="numeric"
          placeholder="5511999999999"
          autoComplete="tel-national"
          aria-invalid={!!errors.phone}
          {...register('phone')}
        />
        {errors.phone && (
          <p className="text-xs text-destructive" role="alert">
            {errors.phone.message}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Somente números. Com DDI: 5511999999999 — sem DDI: 11999999999
        </p>
      </div>

      {notFound && (
        <div
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          No instance found for this phone number. Please contact your administrator.
        </div>
      )}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Searching...
          </>
        ) : (
          'Find My Instance'
        )}
      </Button>
    </form>
  )
}
