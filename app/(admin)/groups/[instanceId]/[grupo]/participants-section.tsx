'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Crown, Search, ShieldCheck, ShieldOff, UserMinus } from 'lucide-react'

import type { SecaoProps } from './tipos'
import { chamarApi, rotaDoGrupo } from '@/components/admin/groups/chamar-api'
import { ConfirmDialog } from '@/components/admin/groups/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { Participante } from '@/lib/groups/gestao'
import { normalizarBusca } from '../group-list'

/** Quantas linhas desenhar. Acima disso a pessoa refina a busca. */
const LIMITE_DE_LINHAS = 100

type Acao = 'remove' | 'promote' | 'demote'

interface Respostas {
  sucessos: string[]
  falhas: { jid: string; codigo: number }[]
  protegidos: string[]
  naoEstao: string[]
}

function rotuloDe(p: Participante): string {
  return p.nome ?? (p.telefone ? `+${p.telefone}` : 'Número oculto')
}

export function ParticipantsSection({
  instanceId, groupjid, podeEditar, aoMudar, participantes,
}: SecaoProps & { participantes: Participante[] }) {
  const [busca, setBusca] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [remover, setRemover] = useState<Participante | null>(null)

  const filtrados = useMemo(() => {
    const termo = normalizarBusca(busca)
    if (!termo) return participantes

    return participantes.filter(
      (p) => normalizarBusca(p.nome ?? '').includes(termo) || (p.telefone ?? '').includes(termo.replace(/\D/g, '') || '\u0000')
    )
  }, [participantes, busca])

  async function agir(acao: Acao, p: Participante) {
    setOcupado(true)
    const r = await chamarApi<Respostas>(rotaDoGrupo(instanceId, 'participants'), {
      groupjid, acao, participantes: [p.jid],
    })
    setOcupado(false)
    setRemover(null)

    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }

    const { sucessos, falhas, protegidos, naoEstao } = r.dados
    if (sucessos.length > 0) {
      toast.success(
        acao === 'remove' ? `${rotuloDe(p)} foi removido(a).`
        : acao === 'promote' ? `${rotuloDe(p)} agora é admin.`
        : `${rotuloDe(p)} deixou de ser admin.`
      )
    } else if (protegidos.length > 0) {
      toast.error('Admin não é removido direto. Rebaixe a pessoa primeiro.')
    } else if (naoEstao.length > 0) {
      toast.error('Essa pessoa não está mais no grupo.')
    } else if (falhas.length > 0) {
      toast.error(`O WhatsApp recusou a operação (código ${falhas[0].codigo}).`)
    }
    aoMudar()
  }

  const visiveis = filtrados.slice(0, LIMITE_DE_LINHAS)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Participantes ({participantes.length})</CardTitle>
        <CardDescription>
          {participantes.some((p) => !p.telefone)
            ? 'Alguns participantes têm o número oculto pelo WhatsApp — não aparecem em buscas por telefone.'
            : 'Quem está no grupo agora.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome ou telefone…"
            className="pl-8"
            aria-label="Buscar participante"
          />
        </div>

        <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {visiveis.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhum participante encontrado.</li>
          )}

          {visiveis.map((p) => (
            <li key={p.jid} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{rotuloDe(p)}</span>
                {p.nome && p.telefone && <span className="block text-xs text-muted-foreground">+{p.telefone}</span>}
              </span>

              {p.superAdmin ? (
                <Badge variant="outline" className="gap-1"><Crown className="size-3" aria-hidden />dono</Badge>
              ) : p.admin ? (
                <Badge variant="outline" className="gap-1"><ShieldCheck className="size-3" aria-hidden />admin</Badge>
              ) : null}

              {podeEditar && !p.superAdmin && (
                <span className="flex shrink-0 gap-1">
                  {p.admin ? (
                    <Button
                      size="icon-sm" variant="ghost" disabled={ocupado}
                      onClick={() => void agir('demote', p)}
                      aria-label={`Rebaixar ${rotuloDe(p)}`} title="Tirar de admin"
                    >
                      <ShieldOff />
                    </Button>
                  ) : (
                    <Button
                      size="icon-sm" variant="ghost" disabled={ocupado}
                      onClick={() => void agir('promote', p)}
                      aria-label={`Promover ${rotuloDe(p)}`} title="Tornar admin"
                    >
                      <ShieldCheck />
                    </Button>
                  )}
                  <Button
                    size="icon-sm" variant="ghost" className="text-destructive"
                    disabled={ocupado || p.admin}
                    onClick={() => setRemover(p)}
                    aria-label={`Remover ${rotuloDe(p)}`}
                    title={p.admin ? 'Rebaixe antes de remover' : 'Remover do grupo'}
                  >
                    <UserMinus />
                  </Button>
                </span>
              )}
            </li>
          ))}

          {filtrados.length > LIMITE_DE_LINHAS && (
            <li className="px-3 py-2 text-center text-xs text-muted-foreground">
              Mostrando {LIMITE_DE_LINHAS} de {filtrados.length}. Refine a busca.
            </li>
          )}
        </ul>
      </CardContent>

      <ConfirmDialog
        aberto={remover !== null}
        aoMudar={(a) => { if (!a) setRemover(null) }}
        titulo="Remover do grupo?"
        descricao={remover ? `${rotuloDe(remover)} será removido(a) do grupo.` : ''}
        confirmar="Remover"
        destrutivo
        ocupado={ocupado}
        aoConfirmar={() => remover && void agir('remove', remover)}
      />
    </Card>
  )
}
