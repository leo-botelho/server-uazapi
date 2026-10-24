'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { CirclePause, UserCheck, UserX } from 'lucide-react'

import type { SecaoProps } from './tipos'
import { chamarApi, rotaDoGrupo } from '@/components/admin/groups/chamar-api'
import { ConfirmDialog } from '@/components/admin/groups/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { LOTE_DE_PARTICIPANTES, emLotes, type Solicitacao } from '@/lib/groups/gestao'
import { formatarTelefone } from '@/lib/groups/csv'

/** Entre um lote e o seguinte. Aprovar não notifica ninguém por conta própria, mas a rajada parece automação. */
const ESPERA_ENTRE_LOTES_S = 5

/** Acima disto, a confirmação pede para digitar a quantidade: um clique distraído aprovaria gente demais. */
const CONFIRMAR_DIGITANDO_ACIMA_DE = 30

type Acao = 'approve' | 'reject'

interface Andamento {
  feitos: number
  total: number
  sucessos: number
  falhas: number
  naoEstao: number
  esperaS: number | null
  erro: string | null
  fim: boolean
}

const rotulo = (s: Solicitacao) => (s.telefone ? formatarTelefone(s.telefone) : 'Número oculto pelo WhatsApp')

/**
 * Fila de aprovação de entrada: quem pediu para entrar num grupo que exige aprovação.
 *
 * A lista é lida AO VIVO só quando a pessoa pede (é uma consulta a mais, e telefone é dado
 * pessoal: não fica guardado). Aprovar e rejeitar vão em lotes pequenos e a rota REBUSCA a fila
 * antes de cada lote — se outro admin já decidiu, a pessoa vira "já decidido", não erro.
 */
export function SolicitacoesSection({
  instanceId, groupjid, podeEditar, aoMudar, exigeAprovacao,
}: SecaoProps & { exigeAprovacao: boolean | null }) {
  const [fila, setFila] = useState<Solicitacao[] | null>(null)
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set())
  const [carregando, setCarregando] = useState(false)
  const [confirmando, setConfirmando] = useState<Acao | null>(null)
  const [andamento, setAndamento] = useState<Andamento | null>(null)
  const parar = useRef(false)

  const rodando = andamento !== null && !andamento.fim

  async function carregar() {
    setCarregando(true)
    const r = await chamarApi<{ solicitacoes?: Solicitacao[] }>(rotaDoGrupo(instanceId, 'info'), {
      groupjid, convite: false, solicitacoes: true,
    })
    setCarregando(false)

    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }

    setFila(r.dados.solicitacoes ?? [])
    setEscolhidos(new Set())
    setAndamento(null)
  }

  const alternar = (id: string) =>
    setEscolhidos((atual) => {
      const novo = new Set(atual)
      if (novo.has(id)) novo.delete(id)
      else novo.add(id)
      return novo
    })

  async function executar(acao: Acao) {
    setConfirmando(null)
    parar.current = false

    const ids = [...escolhidos]
    const lotes = emLotes(ids, LOTE_DE_PARTICIPANTES)
    const a: Andamento = { feitos: 0, total: ids.length, sucessos: 0, falhas: 0, naoEstao: 0, esperaS: null, erro: null, fim: false }
    setAndamento({ ...a })

    for (let i = 0; i < lotes.length; i++) {
      if (parar.current) break

      const r = await chamarApi<{ sucessos: string[]; falhas: unknown[]; naoEstao: string[] }>(
        rotaDoGrupo(instanceId, 'participants'),
        { groupjid, acao, participantes: lotes[i] }
      )

      if (!r.ok) { a.erro = r.erro; break }   // para no primeiro erro: insistir às cegas só pioraria

      a.sucessos += r.dados.sucessos.length
      a.falhas += r.dados.falhas.length
      a.naoEstao += r.dados.naoEstao.length
      a.feitos += lotes[i].length
      setAndamento({ ...a })

      if (i < lotes.length - 1) {
        for (let s = ESPERA_ENTRE_LOTES_S; s > 0 && !parar.current; s--) {
          setAndamento({ ...a, esperaS: s })
          await new Promise((res) => setTimeout(res, 1000))
        }
        setAndamento({ ...a, esperaS: null })
      }
    }

    a.fim = true
    a.esperaS = null
    setAndamento({ ...a })

    const verbo = acao === 'approve' ? 'aprovados' : 'rejeitados'
    if (a.erro) toast.error(a.erro, { duration: 10000 })
    else toast.success(`${a.sucessos} ${verbo}.`)

    aoMudar()
    await carregar()
    setAndamento({ ...a })   // `carregar` zera o andamento; o resultado deve continuar na tela
  }

  const quantos = escolhidos.size
  const verboAcao = confirmando === 'approve' ? 'Aprovar' : 'Rejeitar'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pedidos de entrada</CardTitle>
        <CardDescription>
          {exigeAprovacao === false
            ? 'Este grupo não exige aprovação: ninguém fica esperando. Ligue “aprovar para entrar” nas configurações para usar a fila.'
            : 'Quem pediu para entrar e aguarda um admin. Aprovar adiciona a pessoa ao grupo.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <Button variant="outline" disabled={carregando || rodando} onClick={() => void carregar()}>
          {carregando ? 'Consultando…' : fila ? 'Atualizar pedidos' : 'Ver pedidos pendentes'}
        </Button>

        {fila && fila.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum pedido pendente agora.</p>
        )}

        {fila && fila.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">{fila.length} {fila.length === 1 ? 'pedido' : 'pedidos'} · {quantos} selecionado(s)</span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" disabled={rodando} onClick={() => setEscolhidos(new Set(fila.map((s) => s.id)))}>
                  Selecionar todos
                </Button>
                <Button size="sm" variant="ghost" disabled={rodando || quantos === 0} onClick={() => setEscolhidos(new Set())}>
                  Limpar
                </Button>
              </div>
            </div>

            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
              {fila.map((s) => (
                <li key={s.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                    <Checkbox
                      checked={escolhidos.has(s.id)}
                      disabled={rodando}
                      onCheckedChange={() => alternar(s.id)}
                      aria-label={rotulo(s)}
                    />
                    <span className={s.telefone ? '' : 'text-muted-foreground'}>{rotulo(s)}</span>
                  </label>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-2">
              <Button className="gap-2" disabled={!podeEditar || quantos === 0 || rodando} onClick={() => setConfirmando('approve')}>
                <UserCheck className="size-4" aria-hidden />
                Aprovar {quantos}
              </Button>
              <Button variant="outline" className="gap-2" disabled={!podeEditar || quantos === 0 || rodando} onClick={() => setConfirmando('reject')}>
                <UserX className="size-4" aria-hidden />
                Rejeitar {quantos}
              </Button>
            </div>

            {!podeEditar && (
              <p className="text-xs text-muted-foreground">Só admin do grupo aprova ou rejeita pedidos.</p>
            )}
          </>
        )}

        {andamento && (
          <div className="space-y-2" aria-live="polite">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{!andamento.fim ? 'Processando…' : andamento.erro ? 'Interrompido' : 'Concluído'}</span>
              <span className="text-muted-foreground">{andamento.feitos} de {andamento.total}</span>
            </div>
            <Progress value={andamento.total === 0 ? 0 : Math.round((andamento.feitos / andamento.total) * 100)} />
            <p className="text-xs text-muted-foreground">
              {andamento.sucessos} feitos
              {andamento.falhas > 0 && ` · ${andamento.falhas} recusados pelo WhatsApp`}
              {andamento.naoEstao > 0 && ` · ${andamento.naoEstao} já tinham sido decididos`}
              {andamento.esperaS !== null && ` · próximo lote em ${andamento.esperaS} s`}
            </p>
            {andamento.erro && <Alert variant="destructive"><AlertDescription>{andamento.erro}</AlertDescription></Alert>}
            {rodando && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { parar.current = true }}>
                <CirclePause className="size-3.5" aria-hidden />
                Parar após este lote
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        aberto={confirmando !== null}
        aoMudar={(v) => { if (!v) setConfirmando(null) }}
        titulo={`${verboAcao} ${quantos} ${quantos === 1 ? 'pedido' : 'pedidos'}?`}
        descricao={
          confirmando === 'approve'
            ? `${quantos === 1 ? 'A pessoa entra' : 'As pessoas entram'} no grupo na hora, em lotes de até ${LOTE_DE_PARTICIPANTES} com ${ESPERA_ENTRE_LOTES_S} s entre eles. Mantenha esta aba aberta.`
            : `${quantos === 1 ? 'A pessoa não entra' : 'As pessoas não entram'} no grupo e o pedido some da fila. Não dá para desfazer.`
        }
        confirmar={verboAcao}
        destrutivo={confirmando === 'reject'}
        exigirTexto={quantos > CONFIRMAR_DIGITANDO_ACIMA_DE ? String(quantos) : undefined}
        aoConfirmar={() => { if (confirmando) void executar(confirmando) }}
      />
    </Card>
  )
}
