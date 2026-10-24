'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react'

import { chamarApi, rotaDoGrupo } from '@/components/admin/groups/chamar-api'
import { ConfirmDialog } from '@/components/admin/groups/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  CORES_DAS_ETIQUETAS, MAX_NOME_DA_ETIQUETA, planejarSelecaoPorEtiqueta, validarNomeDaEtiqueta,
  type Etiqueta,
} from '@/lib/groups/etiquetas'

/** Pausa entre um grupo e o seguinte ao aplicar/remover: não é envio, mas não há por que disparar tudo junto. */
const ESPERA_ENTRE_GRUPOS_MS = 1500

function Bolinha({ cor }: { cor: string | null }) {
  return <span className="inline-block size-3 shrink-0 rounded-full border border-border" style={{ background: cor ?? 'transparent' }} aria-hidden />
}

function EscolhaDeCor({ valor, aoMudar }: { valor: number; aoMudar: (n: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Cor da etiqueta">
      {CORES_DAS_ETIQUETAS.map((hex, i) => (
        <button
          key={hex}
          type="button"
          aria-label={`Cor ${i + 1}`}
          aria-pressed={valor === i}
          onClick={() => aoMudar(i)}
          className={`size-6 rounded-full border-2 ${valor === i ? 'border-foreground' : 'border-transparent'}`}
          style={{ background: hex }}
        />
      ))}
    </div>
  )
}

/**
 * Etiquetas do WhatsApp Business para SEGMENTAR a campanha: selecionar de uma vez todos os grupos
 * de uma etiqueta, e aplicar ou tirar uma etiqueta dos grupos selecionados.
 *
 * As etiquetas são lidas ao vivo, só quando a pessoa abre o painel. Aplicar e remover vão UM grupo
 * por pedido (cada um com o seu orçamento de CPU no plano Free). Apagar uma etiqueta a tira de
 * TODAS as conversas da instância, e por isso exige digitar o nome dela.
 */
export function EtiquetasPanel({
  instanceId, conhecidos, selecionados, aoSelecionarVarios,
}: {
  instanceId: string
  /** Os grupos que o painel conhece (o cache): só dá para selecionar o que está na lista. */
  conhecidos: Set<string>
  selecionados: string[]
  aoSelecionarVarios: (jids: string[]) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [etiquetas, setEtiquetas] = useState<Etiqueta[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [escolhida, setEscolhida] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null)
  const [confirmando, setConfirmando] = useState<'aplicar' | 'remover' | null>(null)

  const [gerenciando, setGerenciando] = useState(false)
  const [nomeNova, setNomeNova] = useState('')
  const [corNova, setCorNova] = useState(0)
  const [editando, setEditando] = useState<{ etiqueta: Etiqueta; nome: string; cor: number } | null>(null)
  const [apagando, setApagando] = useState<Etiqueta | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const lendo = progresso !== null
  const atual = etiquetas?.find((e) => e.id === escolhida) ?? null

  async function carregar() {
    setCarregando(true)
    const r = await chamarApi<{ etiquetas: Etiqueta[] }>(rotaDoGrupo(instanceId, 'etiquetas'), { acao: 'listar' })
    setCarregando(false)

    if (!r.ok) { setErro(r.erro); setEtiquetas(null); return }

    setErro(null)
    setEtiquetas(r.dados.etiquetas)
    // Se a etiqueta escolhida deixou de existir, volta para "nenhuma".
    setEscolhida((id) => (r.dados.etiquetas.some((e) => e.id === id) ? id : ''))
  }

  function alternar() {
    const abrindo = !aberto
    setAberto(abrindo)
    if (abrindo && etiquetas === null && !carregando) void carregar()
  }

  async function selecionarPelaEtiqueta() {
    if (!atual) return
    setBuscando(true)
    const r = await chamarApi<{ grupos: string[]; completo: boolean }>(rotaDoGrupo(instanceId, 'etiquetas'), {
      acao: 'grupos', labelid: atual.id,
    })
    setBuscando(false)

    if (!r.ok) { toast.error(r.erro, { duration: 9000 }); return }

    const plano = planejarSelecaoPorEtiqueta(r.dados.grupos, conhecidos)
    aoSelecionarVarios(plano.selecionar)

    if (r.dados.grupos.length === 0) {
      toast.info(`Nenhum grupo tem a etiqueta “${atual.nome}”.`)
      return
    }

    toast.success(
      `${plano.selecionar.length} ${plano.selecionar.length === 1 ? 'grupo selecionado' : 'grupos selecionados'} pela etiqueta “${atual.nome}”.`,
      {
        duration: 9000,
        ...(plano.foraDaLista > 0 || !r.dados.completo
          ? {
              description:
                (plano.foraDaLista > 0 ? `${plano.foraDaLista} com a etiqueta não estão na lista: use “Atualizar lista”. ` : '') +
                (!r.dados.completo ? 'A busca parou no limite de 1000 grupos.' : ''),
            }
          : {}),
      }
    )
  }

  async function aplicarOuRemover(acao: 'aplicar' | 'remover') {
    if (!atual) return
    setConfirmando(null)

    const alvos = [...selecionados]
    let feitos = 0
    let erroDoGrupo: string | null = null
    setProgresso({ feitos: 0, total: alvos.length })

    for (const [i, jid] of alvos.entries()) {
      const r = await chamarApi(rotaDoGrupo(instanceId, 'etiquetas'), { acao, labelid: atual.id, groupjid: jid })
      if (!r.ok) { erroDoGrupo = r.erro; break }   // para no primeiro erro: insistir às cegas só pioraria

      feitos++
      setProgresso({ feitos, total: alvos.length })
      if (i < alvos.length - 1) await new Promise((res) => setTimeout(res, ESPERA_ENTRE_GRUPOS_MS))
    }

    setProgresso(null)

    const verbo = acao === 'aplicar' ? 'recebeu a etiqueta' : 'perdeu a etiqueta'
    if (erroDoGrupo) toast.error(`${feitos} de ${alvos.length} ${feitos === 1 ? 'grupo' : 'grupos'} ${verbo}. Parou: ${erroDoGrupo}`, { duration: 12000 })
    else toast.success(`${feitos} ${feitos === 1 ? 'grupo' : 'grupos'}: etiqueta “${atual.nome}” ${acao === 'aplicar' ? 'aplicada' : 'removida'}.`)
  }

  async function salvarEtiqueta(corpo: Record<string, unknown>, sucesso: string) {
    setOcupado(true)
    const r = await chamarApi(rotaDoGrupo(instanceId, 'etiquetas'), corpo)
    setOcupado(false)

    if (!r.ok) { toast.error(r.erro, { duration: 9000 }); return false }
    toast.success(sucesso)
    await carregar()
    return true
  }

  const nomeNovaV = nomeNova.trim() ? validarNomeDaEtiqueta(nomeNova) : null

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Tag className="size-4" aria-hidden />Etiquetas</h3>
        <Button size="sm" variant="outline" aria-expanded={aberto} onClick={alternar}>
          {aberto ? 'Fechar' : 'Usar etiquetas'}
        </Button>
      </div>

      {!aberto && (
        <p className="text-xs text-muted-foreground">Selecione de uma vez todos os grupos de uma etiqueta do WhatsApp Business.</p>
      )}

      {aberto && (
        <div className="space-y-4">
          {carregando && <p className="text-sm text-muted-foreground">Lendo as etiquetas…</p>}

          {erro && (
            <Alert className="border-amber-500/40">
              <AlertDescription className="space-y-2">
                <p>{erro}</p>
                <Button size="sm" variant="outline" onClick={() => void carregar()}>Tentar de novo</Button>
              </AlertDescription>
            </Alert>
          )}

          {etiquetas && etiquetas.length === 0 && !gerenciando && (
            <p className="text-sm text-muted-foreground">Este número não tem etiquetas. Crie a primeira em “Gerenciar”.</p>
          )}

          {etiquetas && etiquetas.length > 0 && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="et-escolha">Etiqueta</Label>
                <select
                  id="et-escolha"
                  value={escolhida}
                  disabled={lendo}
                  onChange={(e) => setEscolhida(e.target.value)}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                >
                  <option value="">Escolha…</option>
                  {etiquetas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                </select>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={!atual || buscando || lendo} onClick={() => void selecionarPelaEtiqueta()}>
                  {buscando ? 'Buscando…' : 'Selecionar os grupos desta etiqueta'}
                </Button>
                <Button size="sm" variant="outline" disabled={!atual || selecionados.length === 0 || lendo} onClick={() => setConfirmando('aplicar')}>
                  {lendo ? `Aplicando ${progresso.feitos}/${progresso.total}…` : `Aplicar aos ${selecionados.length} selecionados`}
                </Button>
                <Button size="sm" variant="ghost" disabled={!atual || selecionados.length === 0 || lendo} onClick={() => setConfirmando('remover')}>
                  Remover dos selecionados
                </Button>
              </div>
            </>
          )}

          {etiquetas !== null && (
            <div className="space-y-3 border-t border-border pt-3">
              <Button size="sm" variant="ghost" className="gap-1.5" aria-expanded={gerenciando} onClick={() => setGerenciando(!gerenciando)}>
                <Pencil className="size-3.5" aria-hidden />
                {gerenciando ? 'Fechar o gerenciamento' : 'Gerenciar etiquetas'}
              </Button>

              {gerenciando && (
                <div className="space-y-3">
                  <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                    {etiquetas.map((e) => (
                      <li key={e.id} className="space-y-2 px-3 py-2">
                        {editando?.etiqueta.id === e.id ? (
                          <div className="space-y-2">
                            <Input
                              aria-label="Novo nome da etiqueta"
                              value={editando.nome}
                              maxLength={MAX_NOME_DA_ETIQUETA}
                              onChange={(ev) => setEditando({ ...editando, nome: ev.target.value })}
                            />
                            <EscolhaDeCor valor={editando.cor} aoMudar={(cor) => setEditando({ ...editando, cor })} />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={ocupado || !validarNomeDaEtiqueta(editando.nome).ok}
                                onClick={async () => {
                                  if (await salvarEtiqueta({ acao: 'editar', labelid: e.id, name: editando.nome, color: editando.cor }, 'Etiqueta atualizada.')) setEditando(null)
                                }}
                              >
                                Salvar
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Bolinha cor={e.corHex} />
                            <span className="min-w-0 flex-1 truncate">{e.nome}</span>
                            <Button size="icon-sm" variant="ghost" aria-label={`Renomear ${e.nome}`} onClick={() => setEditando({ etiqueta: e, nome: e.nome, cor: e.cor ?? 0 })}><Pencil /></Button>
                            <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={`Apagar ${e.nome}`} onClick={() => setApagando(e)}><Trash2 /></Button>
                          </div>
                        )}
                      </li>
                    ))}
                    {etiquetas.length === 0 && <li className="px-3 py-2 text-muted-foreground">Nenhuma etiqueta ainda.</li>}
                  </ul>

                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <Label htmlFor="et-nova">Nova etiqueta</Label>
                    <Input id="et-nova" value={nomeNova} maxLength={MAX_NOME_DA_ETIQUETA} placeholder="Ex.: Turma de março" onChange={(e) => setNomeNova(e.target.value)} />
                    {nomeNovaV && !nomeNovaV.ok && <p className="text-xs text-destructive">{nomeNovaV.erro}</p>}
                    <EscolhaDeCor valor={corNova} aoMudar={setCorNova} />
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={ocupado || !nomeNovaV || !nomeNovaV.ok}
                      onClick={async () => {
                        if (await salvarEtiqueta({ acao: 'criar', name: nomeNova, color: corNova }, 'Etiqueta criada.')) setNomeNova('')
                      }}
                    >
                      <Plus className="size-3.5" aria-hidden />
                      Criar etiqueta
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        aberto={confirmando !== null}
        aoMudar={(v) => { if (!v) setConfirmando(null) }}
        titulo={`${confirmando === 'aplicar' ? 'Aplicar' : 'Remover'} a etiqueta “${atual?.nome ?? ''}” ${confirmando === 'aplicar' ? 'a' : 'de'} ${selecionados.length} ${selecionados.length === 1 ? 'grupo' : 'grupos'}?`}
        descricao={
          confirmando === 'aplicar'
            ? 'A etiqueta aparece nesses grupos no WhatsApp Business do número conectado. Nenhuma mensagem é enviada.'
            : 'A etiqueta deixa de aparecer nesses grupos. A etiqueta em si continua existindo.'
        }
        confirmar={confirmando === 'aplicar' ? 'Aplicar' : 'Remover'}
        aoConfirmar={() => { if (confirmando) void aplicarOuRemover(confirmando) }}
      />

      <ConfirmDialog
        aberto={apagando !== null}
        aoMudar={(v) => { if (!v) setApagando(null) }}
        titulo={`Apagar a etiqueta “${apagando?.nome ?? ''}”?`}
        descricao="Ela é tirada de TODAS as conversas do número, não só dos grupos. Não dá para desfazer."
        confirmar="Apagar etiqueta"
        destrutivo
        exigirTexto={apagando?.nome}
        ocupado={ocupado}
        aoConfirmar={async () => {
          if (!apagando) return
          const ok = await salvarEtiqueta({ acao: 'apagar', labelid: apagando.id, confirmar: true }, 'Etiqueta apagada.')
          if (ok) setApagando(null)
        }}
      />
    </div>
  )
}
