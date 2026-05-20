'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Loader2, MapPin, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProxyCitySelect } from '@/components/client/proxy-city-select'
import type { ProxyCity } from '@/lib/uazapi/types'

interface ClientProxyFormProps {
  clientId: string
  initialCity: string | null
  initialState: string | null
}

export function ClientProxyForm({ clientId, initialCity, initialState }: ClientProxyFormProps) {
  /**
   * `pending` tracks what's currently saved in the DB.
   * `selected` tracks what the user has chosen in the UI (may differ from pending).
   */
  const [pending, setPending] = useState<{ city: string | null; state: string | null }>({
    city: initialCity,
    state: initialState,
  })
  const [selected, setSelected] = useState<ProxyCity | null>(
    initialCity
      ? { value: initialCity, label: initialCity, state: initialState ?? undefined }
      : null
  )
  const [isPending, startTransition] = useTransition()

  // True when the user's selection differs from what's saved in the DB.
  const isDirty =
    (selected?.value ?? null) !== pending.city ||
    (selected?.state ?? null) !== pending.state

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

      const newCity = selected?.value ?? null
      const newState = selected?.state ?? null
      setPending({ city: newCity, state: newState })

      if (selected) {
        toast.success(
          `Proxy configurado: ${selected.label}${selected.state ? ` — ${selected.state.toUpperCase()}` : ''}`
        )
      } else {
        toast.success('Proxy de cidade removido')
      }
    })
  }

  function handleRemove() {
    setSelected(null)
    startTransition(async () => {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxy_city: null, proxy_state: null }),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        toast.error(data.error ?? 'Erro ao remover proxy')
        // restore previous selection on failure
        setSelected(
          pending.city
            ? { value: pending.city, label: pending.city, state: pending.state ?? undefined }
            : null
        )
        return
      }

      setPending({ city: null, state: null })
      toast.success('Proxy de cidade removido')
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 text-sm text-muted-foreground">
        <MapPin className="size-4 shrink-0 mt-0.5" />
        <span>
          Toda vez que a instância deste cliente for conectada, o proxy da cidade selecionada
          será injetado automaticamente — sem precisar escolher na hora.
        </span>
      </div>

      {/* Seletor de cidade — pré-selecionado com o valor salvo */}
      <ProxyCitySelect
        defaultValue={pending.city ?? undefined}
        showEmptyState
        onSelect={setSelected}
      />

      {/* Ações */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isPending || !isDirty}
          className="gap-2"
        >
          {isPending && <Loader2 className="size-3.5 animate-spin" />}
          Salvar
        </Button>

        {pending.city && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleRemove}
            disabled={isPending}
            className="gap-2 text-destructive hover:text-destructive"
          >
            <X className="size-3.5" />
            Remover proxy
          </Button>
        )}
      </div>

      {/* Status atual salvo */}
      <p className="text-xs text-muted-foreground">
        {pending.city ? (
          <>
            Configurado atualmente:{' '}
            <span className="font-medium text-foreground">
              {pending.city.charAt(0).toUpperCase() + pending.city.slice(1)}
              {pending.state ? ` — ${pending.state.toUpperCase()}` : ''}
            </span>
          </>
        ) : (
          'Nenhum proxy configurado — conexão sem proxy regional.'
        )}
      </p>
    </div>
  )
}
