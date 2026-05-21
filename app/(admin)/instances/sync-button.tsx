'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function SyncInstancesButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  async function handleSync() {
    startTransition(async () => {
      try {
        const res = await fetch('/api/instances/sync', { method: 'POST' })
        const data = (await res.json()) as {
          imported?: number
          repaired?: number
          updated?: number
          skipped?: number
          total?: number
          error?: string
        }

        if (!res.ok) {
          toast.error(data.error ?? 'Erro ao sincronizar instâncias')
          return
        }

        const { imported = 0, repaired = 0, updated = 0, total = 0 } = data

        const parts: string[] = []
        if (imported > 0) parts.push(`${imported} importada${imported !== 1 ? 's' : ''}`)
        if (repaired > 0) parts.push(`${repaired} token${repaired !== 1 ? 's' : ''} corrigido${repaired !== 1 ? 's' : ''}`)
        if (updated > 0)  parts.push(`${updated} status atualizado${updated !== 1 ? 's' : ''}`)

        if (parts.length > 0) {
          toast.success(parts.join(' · '))
        } else {
          toast.info(
            total === 0
              ? 'Nenhuma instância encontrada no uazapiGO'
              : `${total} instância${total !== 1 ? 's' : ''} sincronizada${total !== 1 ? 's' : ''}`
          )
        }

        router.refresh()
      } catch {
        toast.error('Erro ao conectar com o servidor')
      }
    })
  }

  return (
    <Button variant="outline" onClick={handleSync} disabled={isPending}>
      <RefreshCw className={`mr-2 size-4 ${isPending ? 'animate-spin' : ''}`} />
      {isPending ? 'Sincronizando...' : 'Sincronizar uazapiGO'}
    </Button>
  )
}
