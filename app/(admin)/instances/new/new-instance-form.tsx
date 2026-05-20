'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface Client {
  id: string
  name: string
}

interface NewInstanceFormProps {
  clients: Client[]
}

export function NewInstanceForm({ clients }: NewInstanceFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState('')
  const [clientId, setClientId] = useState<string>('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    startTransition(async () => {
      const body: Record<string, string> = { name: name.trim() }
      if (clientId) body['clientId'] = clientId

      const res = await fetch('/api/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        toast.error(data.error ?? 'Erro ao criar instância')
        return
      }

      const { instance } = (await res.json()) as { instance: { id: string } }
      toast.success('Instância criada com sucesso!')
      router.push(`/instances/${instance.id}`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="instance-name">
          Nome da instância <span className="text-destructive">*</span>
        </Label>
        <Input
          id="instance-name"
          placeholder="Ex: instancia-empresa-abc"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={isPending}
        />
        <p className="text-xs text-muted-foreground">
          Use apenas letras minúsculas, números e hífens (sem espaços)
        </p>
      </div>

      {/* Client (optional) */}
      <div className="space-y-2">
        <Label htmlFor="instance-client">Cliente (opcional)</Label>
        <Select value={clientId} onValueChange={(v) => setClientId(v ?? '')}>
          <SelectTrigger id="instance-client" className="w-full">
            <SelectValue placeholder="Selecione um cliente..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">— Sem cliente —</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {clients.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Nenhum cliente cadastrado ainda.{' '}
            <a href="/clients/new" className="underline">
              Criar cliente
            </a>
          </p>
        )}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
        <strong>Atenção:</strong> Para criar instâncias, o servidor uazapiGO precisa estar configurado
        no seu{' '}
        <a href="/profile" className="underline">
          perfil
        </a>
        .
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending || !name.trim()}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Criando...
            </>
          ) : (
            'Criar instância'
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => router.push('/instances')}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}
