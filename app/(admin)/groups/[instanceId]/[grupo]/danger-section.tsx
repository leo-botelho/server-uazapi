'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { LogOut } from 'lucide-react'

import type { SecaoProps } from './tipos'
import { chamarApi, rotaDoGrupo } from '@/components/admin/groups/chamar-api'
import { ConfirmDialog } from '@/components/admin/groups/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Sair do grupo.
 *
 * ⚠️ Se o número conectado for o ÚLTIMO admin, o grupo é DISSOLVIDO para todos,
 * sem volta. A confirmação exige digitar o nome do grupo e, quando somos admin,
 * avisa disso com todas as letras.
 */
export function DangerSection({
  instanceId, groupjid, nomeDoGrupo, souAdmin,
}: Omit<SecaoProps, 'podeEditar' | 'aoMudar'> & { nomeDoGrupo: string; souAdmin: boolean }) {
  const router = useRouter()
  const [confirmando, setConfirmando] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  async function sair() {
    setOcupado(true)
    const r = await chamarApi(rotaDoGrupo(instanceId, 'leave'), { groupjid, confirmar: true })
    setOcupado(false)

    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }

    toast.success('O número saiu do grupo.')
    router.push(`/groups/${instanceId}`)
    router.refresh()
  }

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Zona de risco</CardTitle>
        <CardDescription>Ações que não têm volta.</CardDescription>
      </CardHeader>

      <CardContent>
        <Button variant="destructive" className="gap-2" onClick={() => setConfirmando(true)}>
          <LogOut className="size-4" aria-hidden />
          Sair do grupo
        </Button>
      </CardContent>

      <ConfirmDialog
        aberto={confirmando}
        aoMudar={setConfirmando}
        titulo="Sair deste grupo?"
        descricao="O número conectado deixa de fazer parte do grupo e para de receber as mensagens dele."
        confirmar="Sair do grupo"
        destrutivo
        exigirTexto={nomeDoGrupo}
        ocupado={ocupado}
        aoConfirmar={() => void sair()}
      >
        {souAdmin && (
          <Alert variant="destructive">
            <AlertDescription>
              Este número é admin. <strong>Se for o único admin, o grupo será dissolvido para todos os
              participantes</strong> — e isso não tem volta.
            </AlertDescription>
          </Alert>
        )}
      </ConfirmDialog>
    </Card>
  )
}
