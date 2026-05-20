'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil, X, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Client {
  id: string
  name: string
  email: string | null
}

interface LinkClientFormProps {
  instanceId: string
  currentClientId: string | null
  clients: Client[]
}

export function LinkClientForm({
  instanceId,
  currentClientId,
  clients,
}: LinkClientFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string>(currentClientId ?? '__none__')

  function handleCancel() {
    setSelected(currentClientId ?? '__none__')
    setEditing(false)
  }

  async function handleSave() {
    startTransition(async () => {
      const res = await fetch(`/api/instances/${instanceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selected === '__none__' ? null : selected,
        }),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        toast.error(data.error ?? 'Erro ao vincular cliente')
        return
      }

      toast.success(
        selected === '__none__'
          ? 'Vínculo com cliente removido'
          : 'Cliente vinculado com sucesso!'
      )
      setEditing(false)
      router.refresh()
    })
  }

  if (!editing) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setEditing(true)}
        className="gap-1.5"
      >
        <Pencil className="size-3" />
        {currentClientId ? 'Alterar cliente' : 'Vincular cliente'}
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select
        value={selected}
        onValueChange={(v) => setSelected(v ?? '__none__')}
      >
        <SelectTrigger className="w-56">
          <SelectValue placeholder="Selecione um cliente..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— Sem cliente —</SelectItem>
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
              {c.email ? ` (${c.email})` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        size="sm"
        onClick={handleSave}
        disabled={isPending}
        className="gap-1"
      >
        {isPending ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Check className="size-3" />
        )}
        Salvar
      </Button>

      <Button
        size="sm"
        variant="ghost"
        onClick={handleCancel}
        disabled={isPending}
        className="gap-1"
      >
        <X className="size-3" />
        Cancelar
      </Button>
    </div>
  )
}
