'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronDown, ChevronRight, Pause, Pencil, Play, RotateCcw, Trash2, X } from 'lucide-react'

import { chamarApi } from '@/components/admin/groups/chamar-api'
import { ConfirmDialog } from '@/components/admin/groups/confirm-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DateTimeField, formatarEmBrasilia } from '@/components/ui/datetime-field'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ehPassoDeTextoEditavel } from '@/lib/groups/agenda'

interface Ocorrencia {
  id: string
  step_id: string
  run_at: string
  status: string
  total: number
  succeeded: number
  failed: number
  blocked_reason: string | null
}

interface Passo {
  id: string
  step_order: number
  kind: string
  payload: Record<string, unknown>
  offset_minutes: number | null
}

interface Tarefa {
  id: string
  nome: string
  status: string
  motivoDoBloqueio: string | null
  grupos: number
  espacamentoS: number
  marcarTodos: boolean
  passos: Passo[]
  ocorrencias: Ocorrencia[]
}

interface ItemDaOcorrencia {
  id: number
  groupjid: string
  nome: string | null
  status: string
  prevista: string
  executadaEm: string | null
  erro: string | null
  incerto: boolean
}

const ROTULO_DO_TIPO: Record<string, string> = {
  send_text: 'Mensagem de texto',
  send_media: 'Mensagem com mídia',
  send_buttons: 'Mensagem com botões',
  update_name: 'Trocar o nome',
  update_description: 'Trocar a descrição',
  update_image: 'Trocar a foto',
}

const ROTULO_DA_TAREFA: Record<string, string> = {
  scheduled: 'Agendada', running: 'Em andamento', paused: 'Pausada',
  done: 'Concluída', canceled: 'Cancelada', blocked: 'Bloqueada', draft: 'Rascunho',
}

const ROTULO_DA_OCORRENCIA: Record<string, string> = {
  scheduled: 'Aguardando', open: 'Na fila', running: 'Enviando', paused: 'Pausada',
  done: 'Concluída', failed: 'Não rodou', canceled: 'Cancelada',
  blocked_by_wa_limits: 'Bloqueada pelo WhatsApp',
}

const ROTULO_DO_ITEM: Record<string, string> = {
  pending: 'Na fila', running: 'Enviando', sent: 'Feito', failed: 'Falhou',
  skipped: 'Pulado', canceled: 'Cancelado',
}

const corDoStatus = (s: string): 'default' | 'secondary' | 'destructive' | 'outline' =>
  s === 'running' || s === 'open' ? 'default'
  : s === 'blocked' || s === 'blocked_by_wa_limits' || s === 'failed' ? 'destructive'
  : s === 'scheduled' ? 'secondary'
  : 'outline'

/** Resumo do que um passo faz, em uma linha. */
function resumo(p: Passo | undefined): string {
  if (!p) return ''
  const dados = p.payload ?? {}
  const texto = (v: unknown) => (typeof v === 'string' ? v : '')
  switch (p.kind) {
    case 'update_name': return `Novo nome: “${texto(dados.name)}”`
    case 'update_description': return texto(dados.description) ? `Nova descrição: “${texto(dados.description).slice(0, 80)}”` : 'Apagar a descrição'
    case 'update_image': return texto(dados.image) === 'remove' ? 'Remover a foto' : 'Trocar a foto do grupo'
    default: return texto(dados.text) ? `“${texto(dados.text).slice(0, 90)}${texto(dados.text).length > 90 ? '…' : ''}”` : (ROTULO_DO_TIPO[p.kind] ?? '')
  }
}

/** "2 dias depois do início", "3 h 30 min depois do início". */
function atrasoPorExtenso(min: number): string {
  if (min === 0) return 'no início'
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  const partes = [d && `${d} ${d === 1 ? 'dia' : 'dias'}`, h && `${h} h`, m && `${m} min`].filter(Boolean)
  return `${partes.join(' ')} depois do início`
}

function Detalhes({ run, podeRepetir, aoRepetir }: { run: Ocorrencia; podeRepetir: boolean; aoRepetir: () => void }) {
  const [itens, setItens] = useState<ItemDaOcorrencia[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let ativo = true
    fetch(`/api/groups/runs/${run.id}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ itens: ItemDaOcorrencia[] }>) : Promise.reject(new Error('falha'))))
      .then((corpo) => { if (ativo) setItens(corpo.itens) })
      .catch(() => { if (ativo) setErro('Não foi possível carregar os grupos desta execução.') })
    return () => { ativo = false }
    // Recarrega quando o progresso muda.
  }, [run.id, run.succeeded, run.failed, run.status])

  if (erro) return <p className="px-3 py-2 text-sm text-destructive">{erro}</p>
  if (!itens) return <Skeleton className="m-3 h-16" />

  const incertos = itens.filter((i) => i.status === 'failed' && i.incerto).length
  const falhos = itens.filter((i) => i.status === 'failed').length

  return (
    <div className="space-y-2">
      <ul className="max-h-72 divide-y divide-border overflow-y-auto text-sm">
        {itens.map((i) => (
          <li key={i.id} className="flex items-start justify-between gap-3 px-3 py-1.5">
            <div className="min-w-0">
              <p className="truncate">{i.nome ?? i.groupjid}</p>
              {i.erro && <p className="text-xs text-destructive">{i.erro}</p>}
            </div>
            <Badge variant={i.status === 'failed' ? 'destructive' : i.status === 'sent' ? 'default' : 'outline'}>
              {ROTULO_DO_ITEM[i.status] ?? i.status}
            </Badge>
          </li>
        ))}
        {itens.length === 0 && <li className="px-3 py-2 text-muted-foreground">Ainda não há grupos nesta execução.</li>}
      </ul>

      {podeRepetir && falhos > 0 && (
        <div className="space-y-1 px-3 pb-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={aoRepetir}>
            <RotateCcw className="size-3.5" aria-hidden />
            Repetir as falhas
          </Button>
          {incertos > 0 && (
            <p className="text-xs text-muted-foreground">
              {incertos} {incertos === 1 ? 'falha ficou' : 'falhas ficaram'} de fora: o WhatsApp não respondeu a tempo e a
              mensagem pode ter sido entregue. Confira o grupo antes de repetir esses à mão.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const CAMPO_DO_TEXTO: Record<string, string> = { send_text: 'text', update_name: 'name', update_description: 'description' }

function textoDoPasso(p: Passo): string {
  const v = p.payload?.[CAMPO_DO_TEXTO[p.kind] ?? '']
  return typeof v === 'string' ? v : ''
}

/** O nome do agendamento, com lápis para editar na própria linha. */
function NomeEditavel({ tarefa, editavel, aoMudar }: { tarefa: Tarefa; editavel: boolean; aoMudar: () => void }) {
  const [editando, setEditando] = useState(false)
  const [nome, setNome] = useState(tarefa.nome)
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setSalvando(true)
    const r = await chamarApi(`/api/groups/tasks/${tarefa.id}`, { nome }, 'PATCH')
    setSalvando(false)
    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }
    toast.success('Nome atualizado.')
    setEditando(false)
    aoMudar()
  }

  if (!editando) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <CardTitle className="truncate">{tarefa.nome}</CardTitle>
        {editavel && (
          <Button size="icon-sm" variant="ghost" aria-label="Renomear agendamento" onClick={() => { setNome(tarefa.nome); setEditando(true) }}>
            <Pencil />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input aria-label="Novo nome do agendamento" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} className="h-8" />
      <Button size="icon-sm" aria-label="Salvar nome" disabled={salvando || !nome.trim() || nome.trim() === tarefa.nome} onClick={() => void salvar()}><Check /></Button>
      <Button size="icon-sm" variant="ghost" aria-label="Cancelar" onClick={() => setEditando(false)}><X /></Button>
    </div>
  )
}

/**
 * Editar uma execução que ainda não abriu: a hora dela e o texto do passo. O texto vale para
 * TODAS as execuções do passo (é o conteúdo do passo, não de uma data) — e a tela diz isso.
 */
function EdicaoDaExecucao({ run, passo, aoMudar }: { run: Ocorrencia; passo: Passo | undefined; aoMudar: () => void }) {
  const [quando, setQuando] = useState<string | null>(run.run_at)
  const [texto, setTexto] = useState(passo ? textoDoPasso(passo) : '')
  const [salvando, setSalvando] = useState<'hora' | 'texto' | null>(null)

  const textoEditavel = !!passo && ehPassoDeTextoEditavel(passo.kind)
  const horaMudou = !!quando && Date.parse(quando) !== Date.parse(run.run_at)
  const textoMudou = !!passo && texto !== textoDoPasso(passo)

  async function salvarHora() {
    setSalvando('hora')
    const r = await chamarApi(`/api/groups/runs/${run.id}`, { acao: 'reagendar', quando })
    setSalvando(null)
    if (!r.ok) { toast.error(r.erro, { duration: 9000 }); return }
    toast.success('Hora atualizada.')
    aoMudar()
  }

  async function salvarTexto() {
    if (!passo) return
    setSalvando('texto')
    const r = await chamarApi(`/api/groups/steps/${passo.id}`, { texto }, 'PATCH')
    setSalvando(null)
    if (!r.ok) { toast.error(r.erro, { duration: 9000 }); return }
    toast.success('Texto atualizado.')
    aoMudar()
  }

  return (
    <div className="space-y-4 border-b border-border p-3">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Mudar a hora desta execução</p>
        <div className="flex flex-wrap items-center gap-2">
          <DateTimeField value={quando} onChange={setQuando} aria-label="Nova data e hora" />
          <Button size="sm" disabled={!horaMudou || salvando !== null} onClick={() => void salvarHora()}>
            {salvando === 'hora' ? 'Salvando…' : 'Salvar hora'}
          </Button>
        </div>
      </div>

      {textoEditavel && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Editar o texto</p>
          <Textarea rows={3} value={texto} aria-label="Texto do passo" onChange={(e) => setTexto(e.target.value)} />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!textoMudou || salvando !== null} onClick={() => void salvarTexto()}>
              {salvando === 'texto' ? 'Salvando…' : 'Salvar texto'}
            </Button>
            <p className="text-xs text-muted-foreground">Vale para todas as execuções deste passo.</p>
          </div>
        </div>
      )}

      {!textoEditavel && passo && (
        <p className="text-xs text-muted-foreground">
          Mídia, botões e foto não se editam aqui: cancele e crie de novo.
        </p>
      )}
    </div>
  )
}

export function AgendaList({ instanceId }: { instanceId: string }) {
  const [tarefas, setTarefas] = useState<Tarefa[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aberta, setAberta] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState<Tarefa | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [versao, setVersao] = useState(0)

  const recarregar = useCallback(() => setVersao((v) => v + 1), [])

  useEffect(() => {
    let ativo = true

    fetch(`/api/groups/tasks?instanceId=${encodeURIComponent(instanceId)}`)
      .then(async (res) => {
        const corpo = (await res.json()) as { tarefas?: Tarefa[]; error?: string }
        if (!res.ok) throw new Error(corpo.error ?? `Falha (${res.status})`)
        return corpo.tarefas ?? []
      })
      .then((lista) => { if (ativo) { setTarefas(lista); setErro(null) } })
      .catch((e: unknown) => { if (ativo) setErro(e instanceof Error ? e.message : 'Não foi possível carregar.') })

    return () => { ativo = false }
  }, [instanceId, versao])

  // Acompanha o andamento enquanto há alguma execução em curso.
  const emCurso = (tarefas ?? []).some((t) => t.ocorrencias.some((o) => o.status === 'open' || o.status === 'running'))
  useEffect(() => {
    if (!emCurso) return
    const id = setInterval(() => setVersao((v) => v + 1), 8000)
    return () => clearInterval(id)
  }, [emCurso])

  async function agir(t: Tarefa, acao: 'pausar' | 'retomar' | 'cancelar') {
    setOcupado(true)
    const r = await chamarApi(`/api/groups/tasks/${t.id}`, { acao })
    setOcupado(false)
    setCancelando(null)

    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }
    toast.success(acao === 'pausar' ? 'Pausado.' : acao === 'retomar' ? 'Retomado.' : 'Cancelado.')
    recarregar()
  }

  async function repetir(run: Ocorrencia) {
    const r = await chamarApi<{ repetidos: number }>(`/api/groups/runs/${run.id}`, { acao: 'repetir' })
    if (!r.ok) { toast.error(r.erro, { duration: 8000 }); return }
    toast.success(r.dados.repetidos > 0 ? `${r.dados.repetidos} grupo(s) voltaram para a fila.` : 'Nada a repetir.')
    recarregar()
  }

  if (erro && !tarefas) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{erro}</AlertDescription>
      </Alert>
    )
  }

  if (!tarefas) return <Skeleton className="h-48 w-full" />

  if (tarefas.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhum agendamento ainda. Na lista de grupos, escolha “Agendar”.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {tarefas.map((t) => {
        const ativa = t.status === 'scheduled' || t.status === 'running'
        const encerrada = t.status === 'done' || t.status === 'canceled'

        return (
          <Card key={t.id}>
            <CardHeader className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <NomeEditavel tarefa={t} editavel={!encerrada} aoMudar={recarregar} />
                  <p className="text-sm text-muted-foreground">
                    {t.passos.length > 1 ? `${t.passos.length} passos` : (ROTULO_DO_TIPO[t.passos[0]?.kind ?? ''] ?? 'Ação')} ·{' '}
                    {t.grupos} {t.grupos === 1 ? 'grupo' : 'grupos'} · intervalo de {t.espacamentoS} s
                    {t.marcarTodos && ' · marcando todos'}
                  </p>
                  {t.passos.length === 1 && <p className="text-sm">{resumo(t.passos[0])}</p>}
                </div>
                <Badge variant={corDoStatus(t.status)}>{ROTULO_DA_TAREFA[t.status] ?? t.status}</Badge>
              </div>

              {t.motivoDoBloqueio && (
                <Alert variant="destructive">
                  <AlertDescription>{t.motivoDoBloqueio}</AlertDescription>
                </Alert>
              )}

              {!encerrada && (
                <div className="flex flex-wrap gap-2">
                  {ativa && (
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={ocupado} onClick={() => void agir(t, 'pausar')}>
                      <Pause className="size-3.5" aria-hidden />
                      Pausar
                    </Button>
                  )}
                  {(t.status === 'paused' || t.status === 'blocked') && (
                    <Button size="sm" variant="outline" className="gap-1.5" disabled={ocupado} onClick={() => void agir(t, 'retomar')}>
                      <Play className="size-3.5" aria-hidden />
                      Retomar
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="gap-1.5 text-destructive" disabled={ocupado} onClick={() => setCancelando(t)}>
                    <Trash2 className="size-3.5" aria-hidden />
                    Cancelar
                  </Button>
                </div>
              )}
            </CardHeader>

            <CardContent className="space-y-2">
              {t.ocorrencias.map((o) => {
                const feitos = o.succeeded + o.failed
                const expandida = aberta === o.id
                const passo = t.passos.find((p) => p.id === o.step_id)
                return (
                  <div key={o.id} className="rounded-lg border border-border">
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm"
                      aria-expanded={expandida}
                      onClick={() => setAberta(expandida ? null : o.id)}
                    >
                      {expandida ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
                      <span className="font-medium">{formatarEmBrasilia(o.run_at, true)}</span>
                      {t.passos.length > 1 && passo && (
                        <span className="min-w-0 truncate text-muted-foreground">
                          Passo {passo.step_order + 1} · {resumo(passo)}
                          {passo.offset_minutes !== null && ` (${atrasoPorExtenso(passo.offset_minutes)})`}
                        </span>
                      )}
                      <Badge variant={corDoStatus(o.status)}>{ROTULO_DA_OCORRENCIA[o.status] ?? o.status}</Badge>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {o.total > 0 ? `${o.succeeded} ok${o.failed > 0 ? ` · ${o.failed} com problema` : ''} de ${o.total}` : ''}
                      </span>
                    </button>

                    {(o.status === 'open' || o.status === 'running') && o.total > 0 && (
                      <div className="px-3 pb-2">
                        <Progress value={Math.round((feitos / o.total) * 100)} />
                      </div>
                    )}

                    {o.blocked_reason && <p className="px-3 pb-2 text-xs text-muted-foreground">{o.blocked_reason}</p>}

                    {expandida && (
                      <div className="border-t border-border">
                        {o.status === 'scheduled' && !encerrada && (
                          <EdicaoDaExecucao run={o} passo={passo} aoMudar={recarregar} />
                        )}
                        <Detalhes
                          run={o}
                          podeRepetir={t.status === 'scheduled' || t.status === 'running' || t.status === 'done'}
                          aoRepetir={() => void repetir(o)}
                        />
                      </div>
                    )}
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )
      })}

      <ConfirmDialog
        aberto={cancelando !== null}
        aoMudar={(v) => { if (!v) setCancelando(null) }}
        titulo="Cancelar este agendamento?"
        descricao="O que ainda não foi enviado deixa de ser enviado. O que já saiu não pode ser desfeito."
        confirmar="Cancelar agendamento"
        destrutivo
        ocupado={ocupado}
        aoConfirmar={() => { if (cancelando) void agir(cancelando, 'cancelar') }}
      />
    </div>
  )
}
