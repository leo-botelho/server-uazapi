'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { ProxyCitySelect } from '@/components/client/proxy-city-select'
import type { ProxyCity } from '@/lib/uazapi/types'

export function NewClientForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phones, setPhones] = useState<string[]>([''])
  const [proxyCity, setProxyCity] = useState<ProxyCity | null>(null)

  function addPhone() {
    setPhones((prev) => [...prev, ''])
  }

  function removePhone(index: number) {
    setPhones((prev) => prev.filter((_, i) => i !== index))
  }

  function updatePhone(index: number, value: string) {
    setPhones((prev) => prev.map((p, i) => (i === index ? value : p)))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const validPhones = phones.map((p) => p.trim()).filter(Boolean)

    startTransition(async () => {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || undefined,
          phones: validPhones,
          proxy_city: proxyCity?.value ?? null,
          proxy_state: proxyCity?.state ?? null,
        }),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        toast.error(data.error ?? 'Erro ao criar cliente')
        return
      }

      toast.success('Cliente criado com sucesso!')
      router.push('/clients')
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="client-name">
          Nome <span className="text-destructive">*</span>
        </Label>
        <Input
          id="client-name"
          placeholder="Ex: Empresa ABC"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          disabled={isPending}
        />
      </div>

      {/* Email */}
      <div className="space-y-2">
        <Label htmlFor="client-email">Email</Label>
        <Input
          id="client-email"
          type="email"
          placeholder="contato@empresa.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isPending}
        />
      </div>

      {/* Phones */}
      <div className="space-y-2">
        <Label>Telefones</Label>
        <div className="space-y-2">
          {phones.map((phone, index) => (
            <div key={index} className="flex gap-2">
              <Input
                type="tel"
                placeholder="5511999999999"
                value={phone}
                onChange={(e) => updatePhone(index, e.target.value)}
                disabled={isPending}
              />
              {phones.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => removePhone(index)}
                  disabled={isPending}
                  className="shrink-0"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={addPhone}
          disabled={isPending}
          className="gap-1"
        >
          <Plus className="size-3" />
          Adicionar telefone
        </Button>
        <p className="text-xs text-muted-foreground">
          Formato com DDI: 5511999999999 (sem + ou espaços)
        </p>
      </div>

      {/* Proxy city */}
      <ProxyCitySelect onSelect={setProxyCity} />

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending || !name.trim()}>
          {isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Criar cliente
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => router.push('/clients')}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}
