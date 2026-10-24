'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImageIcon, Loader2, Plus, Trash2, X } from 'lucide-react'

import { MessageComposer } from '@/components/admin/groups/message-composer'
import { Button } from '@/components/ui/button'
import { DateTimeField, formatarEmBrasilia } from '@/components/ui/datetime-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MAX_DATAS_POR_PASSO, MAX_PASSOS, pisoEntreAcoesMs } from '@/lib/groups/agenda'
import {
  MINUTOS_POR_UNIDADE, ROTULO_DA_ACAO, ROTULO_DA_UNIDADE, ROTULO_DA_UNIDADE_DA_PAUSA, SEGUNDOS_POR_UNIDADE,
  atrasoEmMinutos, motivoDoPasso, passoVazio, quandoEfetivo,
  type AcaoAgendada, type PassoDaTela, type UnidadeDaPausa, type UnidadeDeAtraso,
} from '@/lib/groups/agenda-tela'
import { MAX_DESCRICAO_DO_GRUPO, MAX_NOME_DO_GRUPO, avisoDoNome } from '@/lib/groups/gestao'
import { prepararFotoDeGrupo } from '@/lib/image-client'

/** Uma execução prevista, para o cronograma que a tela mostra antes de confirmar. */
export interface ExecucaoPrevista {
  quando: string
  passo: number
}

function FotoDoPasso({
  instanceId, passo, aoMudar, disabled,
}: {
  instanceId: string
  passo: PassoDaTela
  aoMudar: (p: Partial<PassoDaTela>) => void
  disabled?: boolean
}) {
  const arquivo = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)

  async function escolher(arq: File | undefined) {
    if (!arq) return
    setEnviando(true)
    try {
      // Mesmo caminho da tela do grupo: reduz no navegador (JPEG ≤ 640×640) e guarda
      // no bucket — a foto é aplicada DIAS depois, então não pode viver só nesta aba.
      const foto = await prepararFotoDeGrupo(arq)

      const form = new FormData()
      form.set('file', new File([foto.blob], 'foto.jpg', { type: 'image/jpeg' }))
      form.set('purpose', 'group_image')
      form.set('instanceId', instanceId)
      form.set('width', String(foto.largura))
      form.set('height', String(foto.altura))

      const up = await fetch('/api/groups/media', { method: 'POST', body: form })
      const corpo = (await up.json()) as { error?: string; media?: { url: string } }
      if (!up.ok || !corpo.media) throw new Error(corpo.error ?? 'Não foi possível guardar a foto.')

      aoMudar({ fotoUrl: corpo.media.url })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível preparar a foto.', { duration: 8000 })
    } finally {
      setEnviando(false)
      if (arquivo.current) arquivo.current.value = ''
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>Nova foto</Label>
      <input ref={arquivo} type="file" accept="image/*" className="hidden" onChange={(e) => void escolher(e.target.files?.[0])} />
      {passo.fotoUrl ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- prévia de um arquivo do bucket; next/image não agrega aqui */}
          <img src={passo.fotoUrl} alt="Prévia da nova foto" className="size-16 rounded-lg border border-border object-cover" />
          <Button type="button" size="sm" variant="ghost" className="gap-1.5" disabled={disabled} onClick={() => aoMudar({ fotoUrl: null })}>
            <Trash2 className="size-3.5" aria-hidden />
            Trocar
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" className="gap-2" disabled={disabled || enviando} onClick={() => arquivo.current?.click()}>
          {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImageIcon className="size-4" aria-hidden />}
          {enviando ? 'Preparando…' : 'Escolher imagem'}
        </Button>
      )}
    </div>
  )
}

function QuandoDoPasso({
  indice, passo, inicio, pisoS, aoMudar, disabled,
}: {
  indice: number
  /** A menor pausa possível: o ritmo do número (o "Intervalo entre grupos" sem a variação). */
  pisoS: number
  passo: PassoDaTela
  /** A primeira data do primeiro passo, quando já escolhida: a âncora das sequências. */
  inicio: string | null
  aoMudar: (p: Partial<PassoDaTela>) => void
  disabled?: boolean
}) {
  const minutos = atrasoEmMinutos(passo)
  const chegada = inicio && minutos !== null ? new Date(Date.parse(inicio) + minutos * 60_000).toISOString() : null
  const quando = quandoEfetivo(passo, indice)

  return (
    <div className="space-y-2">
      <Label>Quando</Label>

      {indice > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Como marcar o quando">
          <Button type="button" size="sm" variant={quando === 'apos' ? 'default' : 'outline'} aria-pressed={quando === 'apos'} disabled={disabled} onClick={() => aoMudar({ quando: 'apos' })}>
            Logo depois do passo anterior
          </Button>
          <Button type="button" size="sm" variant={quando === 'depois' ? 'default' : 'outline'} aria-pressed={quando === 'depois'} disabled={disabled} onClick={() => aoMudar({ quando: 'depois' })}>
            Depois do início
          </Button>
          <Button type="button" size="sm" variant={quando === 'datas' ? 'default' : 'outline'} aria-pressed={quando === 'datas'} disabled={disabled} onClick={() => aoMudar({ quando: 'datas' })}>
            Data fixa
          </Button>
        </div>
      )}

      {quando === 'apos' ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Pausa de</span>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              className="w-24"
              aria-label="Pausa depois do passo anterior"
              placeholder={String(pisoS)}
              value={passo.pausa}
              disabled={disabled}
              onChange={(e) => aoMudar({ pausa: e.target.value === '' ? '' : Number(e.target.value) })}
            />
            <div className="flex gap-1" role="group" aria-label="Unidade da pausa">
              {(Object.keys(SEGUNDOS_POR_UNIDADE) as UnidadeDaPausa[]).map((u) => (
                <Button key={u} type="button" size="sm" variant={passo.unidadeDaPausa === u ? 'default' : 'outline'} aria-pressed={passo.unidadeDaPausa === u} disabled={disabled} onClick={() => aoMudar({ unidadeDaPausa: u })}>
                  {ROTULO_DA_UNIDADE_DA_PAUSA[u]}
                </Button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Começa quando o passo anterior terminar de percorrer todos os grupos, mais esta pausa. Vazio usa o mínimo,
            de {pisoS} s: é o ritmo do número (o “Intervalo entre grupos”, sem a variação), e nenhuma ação sai antes disso.
            Para pausas menores, diminua o intervalo entre grupos (mínimo de 5 s; marcando todos, 60 s).
            O horário exato aparece em “O que vai acontecer”.
          </p>
        </div>
      ) : quando === 'depois' ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              className="w-24"
              aria-label="Quanto tempo depois"
              value={passo.atraso}
              disabled={disabled}
              onChange={(e) => aoMudar({ atraso: e.target.value === '' ? '' : Number(e.target.value) })}
            />
            <div className="flex gap-1" role="group" aria-label="Unidade">
              {(Object.keys(MINUTOS_POR_UNIDADE) as UnidadeDeAtraso[]).map((u) => (
                <Button key={u} type="button" size="sm" variant={passo.unidade === u ? 'default' : 'outline'} aria-pressed={passo.unidade === u} disabled={disabled} onClick={() => aoMudar({ unidade: u })}>
                  {ROTULO_DA_UNIDADE[u]}
                </Button>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {chegada
              ? `Cai em ${formatarEmBrasilia(chegada)} (Brasília).`
              : inicio ? 'Informe quanto tempo depois do início.' : 'Escolha primeiro a data do passo 1: é a partir dela que a sequência conta.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {passo.datas.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <DateTimeField
                value={d}
                disabled={disabled}
                aria-label={`Data e hora ${i + 1}`}
                onChange={(novo) => aoMudar({ datas: passo.datas.map((x, j) => (j === i ? novo : x)) })}
              />
              {passo.datas.length > 1 && (
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remover a data ${i + 1}`} disabled={disabled} onClick={() => aoMudar({ datas: passo.datas.filter((_, j) => j !== i) })}>
                  <X aria-hidden />
                </Button>
              )}
            </div>
          ))}
          {passo.datas.length < MAX_DATAS_POR_PASSO && (
            <Button type="button" size="sm" variant="ghost" className="gap-1.5" disabled={disabled} onClick={() => aoMudar({ datas: [...passo.datas, null] })}>
              <Plus className="size-3.5" aria-hidden />
              Repetir em outra data
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Compositor de agendamento: um nome e uma lista de PASSOS. Cada passo tem a sua
 * ação e o seu quando — é o que permite "trocar o nome na segunda e mandar o aviso
 * na quinta", ou uma sequência (hoje, daqui a 2 dias, daqui a 5).
 */
export function ScheduleComposer({
  instanceId, nome, aoMudarNome, passos, aoMudarPassos, cronograma, espacamentoS, jitterPct, disabled,
}: {
  instanceId: string
  espacamentoS: number
  jitterPct: number
  nome: string
  aoMudarNome: (nome: string) => void
  passos: PassoDaTela[]
  aoMudarPassos: (passos: PassoDaTela[]) => void
  /** O que vai acontecer e quando, já validado; vazio enquanto o pedido tem problema. */
  cronograma: ExecucaoPrevista[]
  disabled?: boolean
}) {
  const mudar = (indice: number, parcial: Partial<PassoDaTela>) =>
    aoMudarPassos(passos.map((p, i) => (i === indice ? { ...p, ...parcial } : p)))

  const primeiraData = passos[0]?.datas.find((d): d is string => d !== null) ?? null
  // O início da sequência é a PRIMEIRA data do primeiro passo, ordenadas.
  const inicio = passos[0]
    ? [...passos[0].datas].filter((d): d is string => d !== null).sort()[0] ?? primeiraData
    : null

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="ag-nome">Nome do agendamento</Label>
        <Input
          id="ag-nome"
          value={nome}
          placeholder="Ex.: Lançamento da turma de março"
          maxLength={120}
          disabled={disabled}
          onChange={(e) => aoMudarNome(e.target.value)}
        />
      </div>

      {passos.map((passo, i) => {
        const pendente = motivoDoPasso(passo, i)

        return (
          <section key={passo.chave} className="space-y-4 rounded-lg border border-border p-4" aria-label={`Passo ${i + 1}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Passo {i + 1}</h3>
              {passos.length > 1 && (
                <Button type="button" size="sm" variant="ghost" className="gap-1.5 text-destructive" disabled={disabled} onClick={() => aoMudarPassos(passos.filter((_, j) => j !== i))}>
                  <Trash2 className="size-3.5" aria-hidden />
                  Remover
                </Button>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>O que fazer</Label>
              <div className="flex flex-wrap gap-2" role="group" aria-label="O que fazer">
                {(Object.keys(ROTULO_DA_ACAO) as AcaoAgendada[]).map((a) => (
                  <Button key={a} type="button" size="sm" variant={passo.acao === a ? 'default' : 'outline'} aria-pressed={passo.acao === a} disabled={disabled} onClick={() => mudar(i, { acao: a })}>
                    {ROTULO_DA_ACAO[a]}
                  </Button>
                ))}
              </div>
              {passo.acao !== 'mensagem' && (
                <p className="text-xs text-muted-foreground">
                  Alterações exigem que o número seja admin do grupo. O mesmo valor vale para todos os grupos selecionados.
                </p>
              )}
            </div>

            {passo.acao === 'mensagem' && (
              <MessageComposer instanceId={instanceId} rascunho={passo.rascunho} aoMudar={(rascunho) => mudar(i, { rascunho })} disabled={disabled} />
            )}

            {passo.acao === 'nome' && (
              <div className="space-y-1.5">
                <Label htmlFor={`ag-nome-grupo-${i}`}>Novo nome do grupo</Label>
                <Input id={`ag-nome-grupo-${i}`} value={passo.novoNome} disabled={disabled} onChange={(e) => mudar(i, { novoNome: e.target.value })} />
                <p className={`text-xs ${[...passo.novoNome.trim()].length > MAX_NOME_DO_GRUPO ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {[...passo.novoNome.trim()].length}/{MAX_NOME_DO_GRUPO}
                </p>
                {avisoDoNome(passo.novoNome) && <p className="text-xs text-amber-400">{avisoDoNome(passo.novoNome)}</p>}
              </div>
            )}

            {passo.acao === 'descricao' && (
              <div className="space-y-1.5">
                <Label htmlFor={`ag-desc-grupo-${i}`}>Nova descrição</Label>
                <Textarea id={`ag-desc-grupo-${i}`} rows={4} value={passo.novaDescricao} disabled={disabled} onChange={(e) => mudar(i, { novaDescricao: e.target.value })} />
                <p className={`text-xs ${[...passo.novaDescricao.trim()].length > MAX_DESCRICAO_DO_GRUPO ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {[...passo.novaDescricao.trim()].length}/{MAX_DESCRICAO_DO_GRUPO} · deixe vazio para apagar a descrição
                </p>
              </div>
            )}

            {passo.acao === 'foto' && (
              <FotoDoPasso instanceId={instanceId} passo={passo} aoMudar={(p) => mudar(i, p)} disabled={disabled} />
            )}

            <QuandoDoPasso indice={i} passo={passo} inicio={inicio} pisoS={pisoEntreAcoesMs(espacamentoS, jitterPct) / 1000} aoMudar={(p) => mudar(i, p)} disabled={disabled} />

            {pendente && <p className="text-xs text-amber-400">Falta: {pendente}</p>}
          </section>
        )
      })}

      {passos.length < MAX_PASSOS && (
        <Button type="button" variant="outline" className="gap-2" disabled={disabled} onClick={() => aoMudarPassos([...passos, passoVazio('apos')])}>
          <Plus className="size-4" aria-hidden />
          Adicionar passo
        </Button>
      )}

      {cronograma.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-border p-4" aria-label="Cronograma">
          <p className="text-sm font-medium">O que vai acontecer</p>
          <ol className="space-y-1 text-sm text-muted-foreground">
            {cronograma.map((e, i) => (
              <li key={i}>
                <span className="text-foreground">{formatarEmBrasilia(e.quando, true)}</span> — passo {e.passo}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">Horário de Brasília. Cada execução percorre os grupos respeitando o intervalo.</p>
        </div>
      )}
    </div>
  )
}
