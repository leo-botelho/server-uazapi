'use client'

import { useState } from 'react'
import { Copy, CheckCircle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

export function ConnectUrlButton() {
  const [copied, setCopied] = useState(false)

  // Always use the current origin so it works in any environment
  const connectUrl =
    (process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin) + '/connect'

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(connectUrl)
      setCopied(true)
      toast.success('Link copiado!')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Não foi possível copiar')
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopy}
        className="gap-2 font-mono text-xs"
        title={connectUrl}
      >
        {copied ? (
          <CheckCircle className="size-3.5 text-green-600" />
        ) : (
          <Copy className="size-3.5" />
        )}
        {copied ? 'Copiado!' : '/connect'}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        onClick={() => window.open(connectUrl, '_blank')}
        title={`Abrir ${connectUrl}`}
      >
        <ExternalLink className="size-3.5" />
      </Button>
    </div>
  )
}
