'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export function ServerForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState({ name: '', url: '', admin_token: '' })

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        toast.error(data.error ?? 'Erro ao salvar servidor')
        return
      }

      toast.success('Servidor adicionado com sucesso!')
      setForm({ name: '', url: '', admin_token: '' })
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="server-name">Nome</Label>
        <Input
          id="server-name"
          placeholder="SmartSkills Hub"
          value={form.name}
          onChange={set('name')}
          required
          disabled={isPending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="server-url">URL do servidor</Label>
        <Input
          id="server-url"
          placeholder="https://smartskillshub.uazapi.com"
          value={form.url}
          onChange={set('url')}
          required
          disabled={isPending}
          type="url"
        />
        <p className="text-xs text-muted-foreground">
          URL completa sem barra no final, ex: https://smartskillshub.uazapi.com
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="server-token">Admin Token</Label>
        <Input
          id="server-token"
          placeholder="seu-admintoken-uazapi"
          value={form.admin_token}
          onChange={set('admin_token')}
          required
          disabled={isPending}
          type="password"
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Token de administrador do servidor uazapiGO. Armazenado de forma segura no banco.
        </p>
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Adicionar servidor
      </Button>
    </form>
  )
}
