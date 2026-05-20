'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProxyCitySelect } from '@/components/client/proxy-city-select'
import type { ProxyCity } from '@/lib/uazapi/types'

interface ClientProxyFormProps {
  clientId: string
  /** Currently saved values (null = none configured). */
  initialCity: string | null
  initialState: string | null
}

export function ClientProxyForm({ clientId, initialCity, initialState }: ClientProxyFormProps) {
  // Build an initial ProxyCity from DB values so the select shows the right value
  const buildInitial = (): ProxyCity | null => {
    if (!initialCity) return null
    return {
      value: initialCity,
      label: initialCity.charAt(0).toUpperCase() + initialCity.slice(1),
      state: initialState ?? undefined,
    }
  }

  const [selected, setSelected] = useState<ProxyCity | null>(buildInitial)
  const [isPending, startTransition] = useTransition()

  function handleSave() {
    startTransition(async () => {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxy_city: selected?.value ?? null,
          proxy_state: selected?.state ?? null,
        }),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        toast.error(data.error ?? 'Erro ao salvar cidade do proxy')
        return
      }

      toast.success(
        selected
          ? `Proxy configurado: ${selected.label}${selected.state ? ` — ${selected.state.toUpperCase()}` : ''}`
          : 'Proxy de cidade removido'
      )
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="size-4 shrink-0" />
        <span>
          Toda vez que a instância deste cliente for conectada, o proxy local desta cidade será usado
          automaticamente — sem precisar selecionar na hora da conexão.
        </span>
      </div>

      <ProxyCitySelect
        onSelect={setSelected}
      />

      <Button
        size="sm"
        onClick={handleSave}
        disabled={isPending}
        className="gap-2"
      >
        {isPending && <Loader2 className="size-3.5 animate-spin" />}
        Salvar cidade do proxy
      </Button>

      {selected ? (
        <p className="text-xs text-muted-foreground">
          Configurado:{' '}
          <span className="font-medium text-foreground">
            {selected.label}
            {selected.state ? ` — ${selected.state.toUpperCase()}` : ''}
          </span>
        </p>
      ) : initialCity ? (
        <p className="text-xs text-muted-foreground">
          Configurado atualmente:{' '}
          <span className="font-medium text-foreground">
            {initialCity}
            {initialState ? ` — ${initialState.toUpperCase()}` : ''}
          </span>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum proxy configurado — conexão sem proxy regional.</p>
      )}
    </div>
  )
}
