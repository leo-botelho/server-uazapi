'use client'

import { useState, useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ProxyCity } from '@/lib/uazapi/types'

interface ProxyCitySelectProps {
  serverId?: string
  onSelect: (city: ProxyCity | null) => void
}

export function ProxyCitySelect({ serverId, onSelect }: ProxyCitySelectProps) {
  const [cities, setCities] = useState<ProxyCity[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    const url = new URL('/api/proxy-cities', window.location.origin)
    url.searchParams.set('country', 'br')
    if (serverId) url.searchParams.set('serverId', serverId)

    fetch(url.toString())
      .then((r) => r.json())
      .then((data: ProxyCity[]) => {
        if (Array.isArray(data)) setCities(data)
      })
      .catch(() => {/* fail silently — proxy city is optional */})
      .finally(() => setLoading(false))
  }, [serverId])

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

  if (loading) return null  // don't block the form while loading

  if (cities.length === 0) return null  // proxy not available — hide silently

  return (
    <div className="space-y-1.5">
      <Label htmlFor="proxy-city">Cidade do proxy regional (opcional)</Label>
      <Select value={selected} onValueChange={handleChange}>
        <SelectTrigger id="proxy-city">
          <SelectValue placeholder="Sem preferência" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Sem preferência</SelectItem>
          {cities.map((city) => (
            <SelectItem key={city.value} value={city.value}>
              {city.label}
              {city.state ? ` — ${city.state.toUpperCase()}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Selecione uma cidade brasileira para o proxy de conexão.
      </p>
    </div>
  )
}
