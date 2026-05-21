'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Save, Loader2, Copy, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TokenFormProps {
  instanceId: string
  currentToken: string
}

export function TokenForm({ instanceId, currentToken }: TokenFormProps) {
  const router = useRouter()
  const [token, setToken] = useState(currentToken)
  const [visible, setVisible] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()

  const isDirty = token.trim() !== currentToken.trim()

  async function handleSave() {
    if (!isDirty) return
    startTransition(async () => {
      try {
        const res = await fetch(`/api/instances/${instanceId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uazapiToken: token.trim() }),
        })
        if (!res.ok) {
          const body = (await res.json()) as { error?: string }
          throw new Error(body.error ?? 'Falha ao salvar token')
        }
        toast.success('Token atualizado com sucesso')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao salvar token')
      }
    })
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="uazapi-token" className="text-sm">
          Token uazapiGO
        </Label>
        <p className="text-xs text-muted-foreground">
          Token de autenticação usado para chamadas a esta instância.
          Encontre na interface do uazapiGO (campo <code className="font-mono">token</code> da instância).
        </p>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id="uazapi-token"
            type={visible ? 'text' : 'password'}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="font-mono text-sm pr-10"
            placeholder="Cole o token aqui…"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label={visible ? 'Ocultar token' : 'Mostrar token'}
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>

        <Button
          size="icon"
          variant="outline"
          onClick={handleCopy}
          aria-label="Copiar token"
          title="Copiar token"
        >
          {copied ? (
            <CheckCircle className="size-4 text-green-600" />
          ) : (
            <Copy className="size-4" />
          )}
        </Button>

        <Button
          onClick={handleSave}
          disabled={!isDirty || isPending}
          className="gap-2 shrink-0"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>

      {isDirty && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Alterações não salvas. Clique em &quot;Salvar&quot; para aplicar.
        </p>
      )}
    </div>
  )
}
