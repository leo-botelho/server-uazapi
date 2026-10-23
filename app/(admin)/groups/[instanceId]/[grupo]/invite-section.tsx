'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, Link2, RefreshCw } from 'lucide-react'

import type { SecaoProps } from './tipos'
import { chamarApi, rotaDoGrupo } from '@/components/admin/groups/chamar-api'
import { ConfirmDialog } from '@/components/admin/groups/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

/**
 * Link de convite do grupo: ver, copiar e renovar.
 *
 * Renovar INVALIDA o link antigo — todo link já divulgado para de funcionar.
 * Por isso pede confirmação, e a rota exige `confirmar: true` por conta própria.
 */
export function InviteSection({ instanceId, groupjid, podeEditar, linkInicial }: SecaoProps & { linkInicial: string | null }) {
  const [link, setLink] = useState<string | null>(linkInicial)
  const [ocupado, setOcupado] = useState(false)
  const [confirmando, setConfirmando] = useState(false)

  async function ver() {
    setOcupado(true)
    const r = await chamarApi<{ link: string | null }>(rotaDoGrupo(instanceId, 'invite'), { groupjid, acao: 'ver' })
    setOcupado(false)

    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }
    if (!r.dados.link) { toast.error('O WhatsApp não devolveu o link deste grupo.'); return }
    setLink(r.dados.link)
  }

  async function renovar() {
    setOcupado(true)
    const r = await chamarApi<{ link: string | null }>(rotaDoGrupo(instanceId, 'invite'), {
      groupjid, acao: 'resetar', confirmar: true,
    })
    setOcupado(false)
    setConfirmando(false)

    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }
    setLink(r.dados.link)
    toast.success('Link renovado. O anterior não funciona mais.')
  }

  async function copiar() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Link copiado.')
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Convite</CardTitle>
        <CardDescription>O link que leva gente para dentro do grupo.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {link ? (
          <div className="flex items-center gap-2">
            <Input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Link de convite" />
            <Button size="icon" variant="outline" onClick={() => void copiar()} aria-label="Copiar link"><Copy /></Button>
          </div>
        ) : (
          <Button variant="outline" className="gap-2" disabled={!podeEditar || ocupado} onClick={() => void ver()}>
            <Link2 className="size-4" aria-hidden />
            {ocupado ? 'Buscando…' : 'Mostrar link'}
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-destructive"
          disabled={!podeEditar || ocupado}
          onClick={() => setConfirmando(true)}
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Renovar link
        </Button>
      </CardContent>

      <ConfirmDialog
        aberto={confirmando}
        aoMudar={setConfirmando}
        titulo="Renovar o link de convite?"
        descricao="O link atual deixa de funcionar na hora. Quem já recebeu o link antigo — em mensagens, posts, páginas — não consegue mais entrar por ele."
        confirmar="Renovar link"
        destrutivo
        ocupado={ocupado}
        aoConfirmar={() => void renovar()}
      />
    </Card>
  )
}
