'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface ProfileFormProps {
  profile: {
    full_name: string | null
    uazapi_server_url: string
    uazapi_admin_token: string
  } | null
}

export function ProfileForm({ profile }: ProfileFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState({
    full_name: profile?.full_name ?? '',
    uazapi_server_url: profile?.uazapi_server_url ?? '',
    uazapi_admin_token: '',
  })

  function set(field: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const body: Record<string, string> = {
        full_name: form.full_name,
        uazapi_server_url: form.uazapi_server_url,
      }

      // Only send the token if the user actually typed something
      if (form.uazapi_admin_token.trim() !== '') {
        body['uazapi_admin_token'] = form.uazapi_admin_token
      }

      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        toast.error(data.error ?? 'Erro ao salvar perfil')
        return
      }

      toast.success('Perfil salvo com sucesso!')
      // Clear the token field after a successful save
      setForm((prev) => ({ ...prev, uazapi_admin_token: '' }))
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="full-name">Nome completo</Label>
        <Input
          id="full-name"
          placeholder="Seu nome"
          value={form.full_name}
          onChange={set('full_name')}
          disabled={isPending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="server-url">URL do servidor uazapiGO</Label>
        <Input
          id="server-url"
          type="url"
          placeholder="https://smartskillshub.uazapi.com"
          value={form.uazapi_server_url}
          onChange={set('uazapi_server_url')}
          disabled={isPending}
        />
        <p className="text-xs text-muted-foreground">
          URL completa sem barra no final
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="admin-token">Admin Token</Label>
        <Input
          id="admin-token"
          type="password"
          placeholder={
            profile?.uazapi_admin_token ? '(token configurado — deixe vazio para manter)' : 'seu-admintoken-uazapi'
          }
          value={form.uazapi_admin_token}
          onChange={set('uazapi_admin_token')}
          disabled={isPending}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground">
          Token de administrador do servidor uazapiGO. Deixe vazio para manter o token atual.
        </p>
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Salvar perfil
      </Button>
    </form>
  )
}
