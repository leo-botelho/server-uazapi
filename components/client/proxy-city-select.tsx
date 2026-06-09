'use client'

import { useState, useEffect } from 'react'
import { Loader2, WifiOff } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ProxyCity } from '@/lib/uazapi/types'

interface ProxyCitySelectProps {
  serverId?: string
  /** Pre-select this city value (e.g. "campinas") — used to show the currently saved city. */
  defaultValue?: string
  /**
   * When true, renders a loading skeleton and an "unavailable" message instead of
   * disappearing silently. Use in forms where the user needs to know the proxy status.
   * Defaults to false (original behavior: hide silently).
   */
  showEmptyState?: boolean
  /**
   * When true, uses technical labels ("Cidade do proxy regional", error messages mentioning
   * proxy/token). When false (default), uses client-friendly language ("Cidade de conexão").
   * The unavailable/error state is always hidden silently when adminView is false.
   */
  adminView?: boolean
  onSelect: (city: ProxyCity | null) => void
}

export function ProxyCitySelect({
  serverId,
  defaultValue,
  showEmptyState = false,
  adminView = false,
  onSelect,
}: ProxyCitySelectProps) {
  const [cities, setCities] = useState<ProxyCity[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string>(defaultValue ?? '')
  const [fetchError, setFetchError] = useState(false)

  useEffect(() => {
    const url = new URL('/api/proxy-cities', window.location.origin)
    url.searchParams.set('country', 'br')
    if (serverId) url.searchParams.set('serverId', serverId)

    fetch(url.toString())
      .then((r) => r.json())
      .then((data: ProxyCity[]) => {
        if (Array.isArray(data)) {
          setCities(data)
          // If a defaultValue was provided, fire onSelect with the matching city object
          // so the parent immediately knows the current selection without user interaction.
          if (defaultValue) {
            const match = data.find((c) => c.value === defaultValue) ?? null
            if (match) onSelect(match)
          }
        } else {
          setFetchError(true)
        }
      })
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, defaultValue])

  function handleChange(value: string | null) {
    const v = value ?? ''
    setSelected(v)
    if (!v || v === '__none__') {
      onSelect(null)
      return
    }
    const city = cities.find((c) => c.value === v) ?? null
    onSelect(city)
  }

  // ── Labels por contexto ───────────────────────────────────────────────────
  const fieldLabel    = adminView ? 'Cidade do proxy regional'  : 'Cidade de conexão'
  const placeholder   = adminView ? 'Sem proxy (padrão)'        : 'Selecione sua cidade'
  const noneLabel     = adminView ? 'Sem proxy (padrão)'        : 'Não especificar'
  const helperText    = adminView
    ? 'A conexão usará um IP da cidade selecionada automaticamente.'
    : 'Escolha a cidade onde seu WhatsApp deve conectar. Isso melhora a estabilidade da conexão.'

  // ── Silent mode (default): hide while loading or when empty ──────────────
  if (!showEmptyState) {
    if (loading || cities.length === 0) return null
  }

  // ── Invisible mode for non-admin when proxy is unavailable ────────────────
  // Clients don't need to see technical error messages about proxy tokens.
  if (!adminView && (fetchError || cities.length === 0)) return null

  // ── Visible mode: always render, show states ──────────────────────────────
  if (loading) {
    return (
      <div className="space-y-1.5">
        <Label>{fieldLabel}</Label>
        <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Carregando cidades…
        </div>
      </div>
    )
  }

  if (fetchError || cities.length === 0) {
    // Only reached when adminView=true (non-admin already returned null above)
    return (
      <div className="space-y-1.5">
        <Label>{fieldLabel}</Label>
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
          <WifiOff className="size-3.5 shrink-0" />
          <span>
            {fetchError
              ? 'Seleção de cidade não disponível neste servidor uazapiGO.'
              : 'Nenhuma cidade disponível neste servidor.'}
            {' '}
            <span className="text-xs opacity-70">
              Este recurso é opcional e não afeta a conectividade da instância.
            </span>
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="proxy-city">{fieldLabel}</Label>
      <Select value={selected} onValueChange={handleChange}>
        <SelectTrigger id="proxy-city">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{noneLabel}</SelectItem>
          {cities.map((city) => (
            <SelectItem key={city.value} value={city.value}>
              {city.label}
              {city.state ? ` — ${city.state.toUpperCase()}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {helperText}
      </p>
    </div>
  )
}
