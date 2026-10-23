'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Trash2, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

/**
 * Remove o cadastro de uma instancia que sumiu do uazapiGO.
 *
 * Pede confirmacao porque e irreversivel: apagar a linha leva junto o historico
 * de eventos, alertas e tokens de reconexao (ON DELETE CASCADE).
 */
export function RemoveMissingInstance({
  instanceId,
  name,
  missingSince,
}: {
  instanceId: string
  name: string
  missingSince: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const desde = new Date(missingSince).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  })

  function remover() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/instances/${instanceId}/purge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const body = (await res.json()) as { error?: string; success?: boolean }

        if (!res.ok) throw new Error(body.error ?? `Falha ao remover (${res.status})`)

        toast.success(`Cadastro de "${name}" removido do painel.`)
        setOpen(false)
        router.refresh()
      } catch (err) {
        // A rota recusa quando a instancia ainda existe no uazapiGO ou quando
        // nao deu para confirmar — o motivo vem pronto para o operador.
        toast.error(err instanceof Error ? err.message : 'Erro ao remover o cadastro', { duration: 10000 })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1 border-destructive/40 text-destructive">
            <Trash2 className="size-3" />
            Remover
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remover o cadastro de &quot;{name}&quot;?</DialogTitle>
          <DialogDescription>
            Esta instância não aparece mais no uazapiGO desde {desde}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <p>Apagar o cadastro leva junto, sem volta:</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>o histórico de eventos de conexão desta instância;</li>
            <li>os alertas já registrados;</li>
            <li>os links de reconexão gerados.</li>
          </ul>
          <p className="text-muted-foreground">
            O cliente vinculado e os demais cadastros não são afetados.
          </p>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={isPending}>Cancelar</Button>} />
          <Button variant="destructive" onClick={remover} disabled={isPending} className="gap-1.5">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            {isPending ? 'Removendo...' : 'Remover definitivamente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
