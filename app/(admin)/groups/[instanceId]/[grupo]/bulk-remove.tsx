'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ShieldAlert, UserMinus } from 'lucide-react'

import type { SecaoProps } from './tipos'
import { chamarApi, rotaDoGrupo } from '@/components/admin/groups/chamar-api'
import { ConfirmDialog } from '@/components/admin/groups/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import {
  ESPERA_ENTRE_LOTES_S, LOTE_DE_PARTICIPANTES,
  emLotes, extrairTelefones, planejarRemocao,
  type Participante, type PlanoDeRemocao,
} from '@/lib/groups/gestao'

interface Analise {
  plano: PlanoDeRemocao
  ignorados: string[]
  pedidos: number
}

interface Andamento {
  feitos: number
  total: number
  removidos: number
  falhas: number
  protegidos: number
  jaSairam: number
  esperaS: number | null
  parou: boolean
  fim: boolean
  erro: string | null
}

const rotulo = (p: Participante) => p.nome ?? (p.telefone ? `+${p.telefone}` : p.jid)

/**
 * Remoção em massa: cola a lista de telefones (compradores, por exemplo), o
 * painel mostra EXATAMENTE quem sairia, e só então remove.
 *
 * A análise acontece aqui, contra a lista de participantes carregada ao vivo.
 * Mesmo assim a rota rebusca o grupo antes de cada lote e recusa admins — esta
 * tela não é a fronteira de segurança, só a pré-visualização.
 */
export function BulkRemove({
  instanceId, groupjid, podeEditar, aoMudar, participantes,
}: SecaoProps & { participantes: Participante[] }) {
  const [texto, setTexto] = useState('')
  const [analise, setAnalise] = useState<Analise | null>(null)
  const [andamento, setAndamento] = useState<Andamento | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const parar = useRef(false)

  const rodando = andamento !== null && !andamento.fim

  // Fechar a aba no meio deixa a lista pela metade e sem aviso de quem faltou.
  useEffect(() => {
    if (!rodando) return
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [rodando])

  function analisar() {
    const { numeros, ignorados } = extrairTelefones(texto)
    setAndamento(null)
    setAnalise({ plano: planejarRemocao(participantes, numeros), ignorados, pedidos: numeros.length })
  }

  async function executar() {
    if (!analise) return
    setConfirmando(false)
    parar.current = false

    const lotes = emLotes(analise.plano.remover.map((p) => p.jid), LOTE_DE_PARTICIPANTES)
    const total = analise.plano.remover.length

    const a: Andamento = {
      feitos: 0, total, removidos: 0, falhas: 0, protegidos: 0, jaSairam: 0,
      esperaS: null, parou: false, fim: false, erro: null,
    }
    setAndamento({ ...a })

    for (let i = 0; i < lotes.length; i++) {
      if (parar.current) { a.parou = true; break }

      const r = await chamarApi<{
        sucessos: string[]; falhas: unknown[]; protegidos: string[]; naoEstao: string[]
      }>(rotaDoGrupo(instanceId, 'participants'), {
        groupjid, acao: 'remove', participantes: lotes[i],
      })

      if (!r.ok) {
        // Para no primeiro erro: continuar às cegas depois de uma recusa só pioraria.
        a.erro = r.erro
        break
      }

      a.removidos += r.dados.sucessos.length
      a.falhas += r.dados.falhas.length
      a.protegidos += r.dados.protegidos.length
      a.jaSairam += r.dados.naoEstao.length
      a.feitos += lotes[i].length
      setAndamento({ ...a })

      // Espera entre lotes: remoção em rajada parece automação para o WhatsApp.
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
    setAnalise(null)

    if (a.erro) toast.error(a.erro, { duration: 10000 })
    else toast.success(`${a.removidos} ${a.removidos === 1 ? 'pessoa removida' : 'pessoas removidas'}.`)
    aoMudar()
  }

  const plano = analise?.plano

  return (
    <Card>
      <CardHeader>
        <CardTitle>Remover em massa</CardTitle>
        <CardDescription>
          Cole uma lista de telefones — de compradores, por exemplo — e veja quem sairia antes de remover.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="bulk-lista">Telefones (um por linha, ou copiados de uma planilha)</Label>
          <Textarea
            id="bulk-lista"
            rows={6}
            value={texto}
            disabled={!podeEditar || rodando}
            onChange={(e) => { setTexto(e.target.value); setAnalise(null) }}
            placeholder={'21 98765-4321\n(11) 99999-0000\n+55 31 98888-7777'}
          />
          <p className="text-xs text-muted-foreground">
            Número sem código do país é tratado como brasileiro (55). O nono dígito é considerado nas
            duas formas — com e sem ele.
          </p>
        </div>

        <Button variant="outline" disabled={!podeEditar || rodando || texto.trim() === ''} onClick={analisar}>
          Ver quem seria removido
        </Button>

        {analise && plano && (
          <div className="space-y-3">
            {analise.pedidos === 0 ? (
              <p className="text-sm text-muted-foreground">Não encontrei nenhum telefone nesse texto.</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-2xl font-semibold">{plano.remover.length}</p>
                    <p className="text-xs text-muted-foreground">sairiam do grupo</p>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-2xl font-semibold">{plano.naoEncontrados.length}</p>
                    <p className="text-xs text-muted-foreground">não estão no grupo</p>
                  </div>
                  <div className="rounded-lg border border-amber-500/40 p-3">
                    <p className="text-2xl font-semibold">{plano.admins.length}</p>
                    <p className="text-xs text-muted-foreground">são admin — ficam de fora</p>
                  </div>
                </div>

                {plano.semNumeroVisivel > 0 && (
                  <Alert className="border-amber-500/40">
                    <ShieldAlert className="text-amber-400" aria-hidden />
                    <AlertDescription>
                      {plano.semNumeroVisivel} participante(s) deste grupo têm o número oculto pelo WhatsApp e
                      não podem ser reconhecidos por telefone. Se algum comprador estiver entre eles, ele
                      não aparece aqui — remova pela lista de participantes.
                    </AlertDescription>
                  </Alert>
                )}

                {plano.remover.length > 0 && (
                  <details className="rounded-lg border border-border text-sm" open>
                    <summary className="cursor-pointer px-3 py-2 font-medium">Quem será removido</summary>
                    <ul className="max-h-48 divide-y divide-border overflow-y-auto border-t border-border">
                      {plano.remover.map((p) => (
                        <li key={p.jid} className="px-3 py-1.5">{rotulo(p)}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {plano.naoEncontrados.length > 0 && (
                  <details className="rounded-lg border border-border text-sm">
                    <summary className="cursor-pointer px-3 py-2 font-medium text-muted-foreground">
                      Não encontrados ({plano.naoEncontrados.length})
                    </summary>
                    <ul className="max-h-40 divide-y divide-border overflow-y-auto border-t border-border text-muted-foreground">
                      {plano.naoEncontrados.map((n) => <li key={n} className="px-3 py-1.5">+{n}</li>)}
                    </ul>
                  </details>
                )}

                {analise.ignorados.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Ignorei {analise.ignorados.length} trecho(s) que pareciam número mas têm tamanho inválido.
                  </p>
                )}

                <Button
                  variant="destructive"
                  className="gap-2"
                  disabled={!podeEditar || plano.remover.length === 0 || rodando}
                  onClick={() => setConfirmando(true)}
                >
                  <UserMinus className="size-4" aria-hidden />
                  Remover {plano.remover.length} {plano.remover.length === 1 ? 'pessoa' : 'pessoas'}
                </Button>
              </>
            )}
          </div>
        )}

        {andamento && (
          <div className="space-y-2" aria-live="polite">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {!andamento.fim ? 'Removendo…' : andamento.erro ? 'Interrompido' : andamento.parou ? 'Parado' : 'Concluído'}
              </span>
              <span className="text-muted-foreground">{andamento.feitos} de {andamento.total}</span>
            </div>
            <Progress value={andamento.total === 0 ? 0 : Math.round((andamento.feitos / andamento.total) * 100)} />

            <p className="text-xs text-muted-foreground">
              {andamento.removidos} removidos
              {andamento.falhas > 0 && ` · ${andamento.falhas} recusados pelo WhatsApp`}
              {andamento.jaSairam > 0 && ` · ${andamento.jaSairam} já tinham saído`}
              {andamento.protegidos > 0 && ` · ${andamento.protegidos} admins protegidos`}
              {andamento.esperaS !== null && ` · próximo lote em ${andamento.esperaS} s`}
            </p>

            {andamento.erro && <p className="text-sm text-destructive">{andamento.erro}</p>}

            {rodando && (
              <Button variant="outline" onClick={() => { parar.current = true }}>
                Parar após este lote
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        aberto={confirmando}
        aoMudar={setConfirmando}
        titulo={`Remover ${plano?.remover.length ?? 0} pessoas do grupo?`}
        descricao={
          `A remoção é em lotes de até ${LOTE_DE_PARTICIPANTES}, com ${ESPERA_ENTRE_LOTES_S} s entre eles. ` +
          'Mantenha esta aba aberta até o fim. Não dá para desfazer.'
        }
        confirmar="Remover"
        destrutivo
        exigirTexto={String(plano?.remover.length ?? 0)}
        aoConfirmar={() => void executar()}
      />
    </Card>
  )
}
