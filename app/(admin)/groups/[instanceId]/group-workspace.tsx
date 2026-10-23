'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarClock, OctagonAlert, RefreshCw, Send, TriangleAlert } from 'lucide-react'

import { DispatchProgress } from './dispatch-progress'
import { GroupList } from './group-list'
import { CAMPOS_VAZIOS, ROTULO_DA_ACAO, ScheduleFields, type CamposDoAgendamento } from './schedule-fields'
import { useDispatch } from './use-dispatch'
import { BanRiskNotice } from '@/components/admin/groups/ban-risk-notice'
import { chamarApi } from '@/components/admin/groups/chamar-api'
import { ConfirmBulkDialog } from '@/components/admin/groups/confirm-bulk-dialog'
import { MessageComposer } from '@/components/admin/groups/message-composer'
import { SpacingField, formatarDuracao } from '@/components/admin/groups/spacing-field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { formatarEmBrasilia } from '@/components/ui/datetime-field'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { exigeConfirmacaoDoAgendamento, validarDatas } from '@/lib/groups/agenda'
import { exigeConfirmacaoDigitada } from '@/lib/groups/dispatch'
import { validarDescricaoDoGrupo, validarNomeDoGrupo } from '@/lib/groups/gestao'
import {
  ESPACAMENTO_PADRAO_S,
  JITTER_PADRAO_PCT,
  MAX_GRUPOS_MARCANDO_TODOS,
  espacamentoMinimo,
} from '@/lib/groups/limits'
import type { GrupoEmCache } from '@/lib/groups/cache'
import type { ResultadoDoPrevoo } from '@/lib/groups/preflight-regras'
import {
  RASCUNHO_VAZIO, rascunhoParaEnvio, resumoDoRascunho, validarRascunho,
  type RascunhoDaMensagem,
} from '@/lib/groups/rascunho'

interface Props {
  instanceId: string
  instanceName: string
  grupos: GrupoEmCache[]
  /** O cache está vazio ou velho: atualiza sozinho ao abrir. */
  precisaAtualizar: boolean
}

export function GroupWorkspace({ instanceId, instanceName, grupos, precisaAtualizar }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const [busca, setBusca] = useState('')
  const [somenteAdmin, setSomenteAdmin] = useState(false)
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [rascunho, setRascunho] = useState<RascunhoDaMensagem>(RASCUNHO_VAZIO)
  const [marcarTodos, setMarcarTodos] = useState(false)
  const [espacamento, setEspacamento] = useState(ESPACAMENTO_PADRAO_S)
  const [confirmando, setConfirmando] = useState(false)
  const [atualizando, setAtualizando] = useState(false)
  const [previo, setPrevio] = useState<ResultadoDoPrevoo | null>(null)
  // Agendar: a mesma tela, com data e hora. Alterações (nome, descrição, foto) só existem aqui.
  const [agendar, setAgendar] = useState(false)
  const [campos, setCampos] = useState<CamposDoAgendamento>(CAMPOS_VAZIOS)
  const [agendando, setAgendando] = useState(false)
  const [erroDeAgendamento, setErroDeAgendamento] = useState<string | null>(null)

  const { estado, erroDeInicio, iniciar, pedirParada, reiniciar } = useDispatch()
  const enviando = estado.fase === 'enviando'
  const mostrandoResultado = estado.fase !== 'ocioso'

  const eMensagem = !agendar || campos.acao === 'mensagem'
  // Marcar todos só vale para mensagens: numa alteração fica desligado de fato.
  const marcandoTodos = marcarTodos && eMensagem

  // O piso sobe sozinho quando liga marcar todos; o valor efetivo nunca fica abaixo dele.
  const espacamentoEfetivo = Math.max(espacamento, espacamentoMinimo(marcandoTodos))

  // Seleção só vale para grupos que ainda existem na lista (ela pode ter sido atualizada).
  const jidsValidos = useMemo(() => new Set(grupos.map((g) => g.group_jid)), [grupos])
  const alvos = useMemo(
    () => [...selecionados].filter((jid) => jidsValidos.has(jid)),
    [selecionados, jidsValidos]
  )

  const nomes = useMemo(
    () => new Map(grupos.map((g) => [g.group_jid, g.name ?? g.group_jid])),
    [grupos]
  )

  // ── Atualizar a lista ──────────────────────────────────────────────────────
  const atualizar = useCallback(async (force: boolean) => {
    setAtualizando(true)
    try {
      const res = await fetch(`/api/instances/${instanceId}/groups/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const corpo = (await res.json()) as {
        error?: string
        refresh?: { atualizados: number; removidos: number; adminInferido: boolean }
      }
      if (!res.ok) throw new Error(corpo.error ?? `Falha ao atualizar (${res.status})`)

      const r = corpo.refresh
      toast.success(
        r
          ? `${r.atualizados} grupos atualizados${r.removidos > 0 ? ` · ${r.removidos} removidos` : ''}.`
          : 'Lista atualizada.'
      )
      startTransition(() => router.refresh())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível atualizar a lista.', { duration: 8000 })
    } finally {
      setAtualizando(false)
    }
  }, [instanceId, router])

  // Cache vazio ou velho: atualiza uma vez ao abrir. O ref evita a segunda
  // chamada do modo estrito do React em desenvolvimento.
  const atualizouAoAbrir = useRef(false)
  useEffect(() => {
    if (!precisaAtualizar || atualizouAoAbrir.current) return
    atualizouAoAbrir.current = true
    void atualizar(false)
  }, [precisaAtualizar, atualizar])

  // ── Pré-voo: o número pode enviar agora? ───────────────────────────────────
  const consultarPrevoo = useCallback(async () => {
    try {
      const res = await fetch(`/api/instances/${instanceId}/groups/preflight`)
      if (!res.ok) return
      const corpo = (await res.json()) as { preflight: ResultadoDoPrevoo }
      setPrevio(corpo.preflight)
    } catch {
      // Não consultar não bloqueia: quem decide de verdade é o servidor no envio.
    }
  }, [instanceId])

  // Ao abrir a tela. `ativo` descarta a resposta se a pessoa sair antes dela
  // chegar — sem isso uma resposta velha poderia sobrescrever uma mais nova.
  useEffect(() => {
    let ativo = true

    fetch(`/api/instances/${instanceId}/groups/preflight`)
      .then((res) => (res.ok ? (res.json() as Promise<{ preflight: ResultadoDoPrevoo }>) : null))
      .then((corpo) => { if (ativo && corpo) setPrevio(corpo.preflight) })
      .catch(() => {
        // Não consultar não bloqueia: quem decide de verdade é o servidor no envio.
      })

    return () => { ativo = false }
  }, [instanceId])

  // ── Seleção ────────────────────────────────────────────────────────────────
  const alternar = (jid: string) =>
    setSelecionados((atual) => {
      const novo = new Set(atual)
      if (novo.has(jid)) novo.delete(jid)
      else novo.add(jid)
      return novo
    })

  // ── Enviar / agendar ───────────────────────────────────────────────────────
  const problema = validarRascunho(rascunho)
  const excedeTetoDeMarcarTodos = marcandoTodos && alvos.length > MAX_GRUPOS_MARCANDO_TODOS
  const bloqueadoNoPrevoo = previo?.bloqueio != null && !previo.podeForcar

  /** Motivo para o botão de agendar estar desligado, ou null quando está tudo certo. */
  function motivoParaNaoAgendar(): string | null {
    if (alvos.length === 0) return 'Selecione pelo menos um grupo.'
    if (campos.acao === 'mensagem' && !problema.ok) return problema.erro
    if (excedeTetoDeMarcarTodos) return `Marcando todos, o limite é de ${MAX_GRUPOS_MARCANDO_TODOS} grupos por execução.`

    if (campos.acao === 'nome') {
      const v = validarNomeDoGrupo(campos.novoNome)
      if (!v.ok) return v.erro
    }
    if (campos.acao === 'descricao') {
      const v = validarDescricaoDoGrupo(campos.novaDescricao)
      if (!v.ok) return v.erro
    }
    if (campos.acao === 'foto' && !campos.fotoUrl) return 'Escolha a nova foto.'

    if (campos.acao !== 'mensagem') {
      const semAdmin = grupos.filter((g) => alvos.includes(g.group_jid) && !g.owner_is_admin)
      if (semAdmin.length > 0) {
        return `O número não é admin em ${semAdmin.length === 1 ? (semAdmin[0].name ?? 'um dos grupos') : `${semAdmin.length} dos grupos`}.`
      }
    }

    if (!campos.nome.trim()) return 'Dê um nome ao agendamento.'

    const datas = validarDatas(campos.quando ? [campos.quando] : [], alvos.length, espacamentoEfetivo)
    if (!datas.ok) return datas.erro

    return null
  }

  const motivoParaNaoEnviar = agendar
    ? motivoParaNaoAgendar()
    : alvos.length === 0 ? 'Selecione pelo menos um grupo.'
    : !problema.ok ? problema.erro
    : excedeTetoDeMarcarTodos
      ? `Marcando todos, o limite é de ${MAX_GRUPOS_MARCANDO_TODOS} grupos por envio.`
    : bloqueadoNoPrevoo ? previo.bloqueio!.motivo
    : null

  const executar = useCallback(async (liberarCota: boolean) => {
    const { kind, payload } = rascunhoParaEnvio(rascunho)

    const concluiu = await iniciar({
      instanceId,
      targetJids: alvos,
      kind,
      payload,
      marcarTodos,
      espacamentoS: espacamentoEfetivo,
      jitterPct: JITTER_PADRAO_PCT,
      liberarCota,
    })

    // Depois de qualquer envio o estado do número pode ter mudado.
    void consultarPrevoo()
    return concluiu
  }, [rascunho, iniciar, instanceId, alvos, marcarTodos, espacamentoEfetivo, consultarPrevoo])

  const agendarAgora = useCallback(async () => {
    setAgendando(true)
    setErroDeAgendamento(null)

    let kind: string
    let payload: Record<string, unknown>
    switch (campos.acao) {
      case 'nome':      kind = 'update_name';        payload = { name: campos.novoNome }; break
      case 'descricao': kind = 'update_description'; payload = { description: campos.novaDescricao }; break
      case 'foto':      kind = 'update_image';       payload = { image: campos.fotoUrl }; break
      default: {
        const envio = rascunhoParaEnvio(rascunho)
        kind = envio.kind
        payload = envio.payload as unknown as Record<string, unknown>
      }
    }

    const r = await chamarApi<{ ocorrencias: number; aviso: string | null }>('/api/groups/tasks', {
      instanceId,
      name: campos.nome,
      targetJids: alvos,
      kind,
      payload,
      datas: campos.quando ? [campos.quando] : [],
      marcarTodos: marcandoTodos,
      espacamentoS: espacamentoEfetivo,
      jitterPct: JITTER_PADRAO_PCT,
    })

    setAgendando(false)

    if (!r.ok) {
      setErroDeAgendamento(r.erro)
      return
    }

    toast.success('Agendado.', r.dados.aviso ? { description: r.dados.aviso, duration: 10000 } : undefined)
    router.push(`/groups/${instanceId}/agenda`)
  }, [campos, rascunho, instanceId, alvos, marcandoTodos, espacamentoEfetivo, router])

  const aoConfirmar = () => {
    setConfirmando(false)
    if (agendar) void agendarAgora()
    else void executar(false)
  }

  const duracao = formatarDuracao(Math.max(0, alvos.length - 1) * espacamentoEfetivo)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* ── Grupos ─────────────────────────────────────────────────────── */}
      <section className="space-y-3" aria-label="Grupos">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Grupos</h2>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={atualizando || enviando}
            onClick={() => void atualizar(true)}
          >
            <RefreshCw className={`size-3.5 ${atualizando ? 'animate-spin' : ''}`} aria-hidden />
            {atualizando ? 'Atualizando…' : 'Atualizar lista'}
          </Button>
        </div>

        <GroupList
          instanceId={instanceId}
          grupos={grupos}
          selecionados={new Set(alvos)}
          busca={busca}
          aoBuscar={setBusca}
          somenteAdmin={somenteAdmin}
          aoMudarSomenteAdmin={setSomenteAdmin}
          aoAlternar={alternar}
          aoSelecionarVarios={(jids) => setSelecionados(new Set(jids))}
          aoLimpar={() => setSelecionados(new Set())}
          disabled={enviando}
        />
      </section>

      {/* ── Mensagem ───────────────────────────────────────────────────── */}
      <section className="space-y-4" aria-label="Mensagem">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">{agendar ? 'Agendar' : 'Mensagem'}</h2>
          {!mostrandoResultado && (
            <div className="flex gap-1.5" role="group" aria-label="Quando executar">
              <Button size="sm" variant={agendar ? 'outline' : 'default'} aria-pressed={!agendar} onClick={() => setAgendar(false)}>
                Enviar agora
              </Button>
              <Button size="sm" variant={agendar ? 'default' : 'outline'} aria-pressed={agendar} className="gap-1.5" onClick={() => setAgendar(true)}>
                <CalendarClock className="size-3.5" aria-hidden />
                Agendar
              </Button>
            </div>
          )}
        </div>

        {mostrandoResultado ? (
          <DispatchProgress
            estado={estado}
            nomes={nomes}
            aoParar={pedirParada}
            aoSelecionarFalhas={(jids) => setSelecionados(new Set(jids))}
            aoNovo={reiniciar}
          />
        ) : (
          <>
            {/* Pré-voo */}
            {previo?.bloqueio && (
              <Alert variant={agendar ? 'default' : 'destructive'} className={agendar ? 'border-amber-500/40' : undefined}>
                <OctagonAlert aria-hidden />
                <AlertTitle>
                  {previo.bloqueio.tipo === 'desconectada' ? 'Instância desconectada'
                    : previo.bloqueio.tipo === 'restricao' ? 'Número restrito pelo WhatsApp'
                    : 'Cota de novas conversas esgotada'}
                </AlertTitle>
                <AlertDescription>
                  {previo.bloqueio.motivo}
                  {previo.bloqueio.ate && ` Até ${new Date(previo.bloqueio.ate).toLocaleString('pt-BR')}.`}
                  {agendar && ' Dá para agendar mesmo assim: na hora, o painel confere de novo e não envia se o número continuar impedido.'}
                </AlertDescription>
              </Alert>
            )}

            {previo?.avisos.map((aviso, i) => (
              <Alert key={i} className="border-amber-500/40">
                <TriangleAlert className="text-amber-400" aria-hidden />
                <AlertDescription>{aviso}</AlertDescription>
              </Alert>
            ))}

            {agendar && (
              <ScheduleFields instanceId={instanceId} valor={campos} aoMudar={setCampos} disabled={agendando} />
            )}

            {eMensagem && (
              <MessageComposer
                instanceId={instanceId}
                rascunho={rascunho}
                aoMudar={setRascunho}
                disabled={enviando || agendando}
              />
            )}

            <div className="space-y-4 rounded-lg border border-border p-4">
              {eMensagem && (
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <Label htmlFor="marcar-todos">Marcar todos (@todos)</Label>
                  <p className="text-xs text-muted-foreground">
                    Notifica todos os participantes de cada grupo. Intervalo mínimo de 60 s e até{' '}
                    {MAX_GRUPOS_MARCANDO_TODOS} grupos por envio.
                  </p>
                </div>
                <Switch id="marcar-todos" checked={marcarTodos} onCheckedChange={setMarcarTodos} />
              </div>
              )}

              <SpacingField
                value={espacamento}
                onChange={setEspacamento}
                marcarTodos={marcandoTodos}
                quantidadeDeGrupos={alvos.length}
              />
            </div>

            {eMensagem && <BanRiskNotice marcarTodos={marcandoTodos} />}

            {agendar && erroDeAgendamento && (
              <Alert variant="destructive">
                <OctagonAlert aria-hidden />
                <AlertTitle>Não foi possível agendar</AlertTitle>
                <AlertDescription>{erroDeAgendamento}</AlertDescription>
              </Alert>
            )}

            {!agendar && erroDeInicio && (
              <Alert variant="destructive">
                <OctagonAlert aria-hidden />
                <AlertTitle>Não foi possível iniciar o envio</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{erroDeInicio.erro}</p>
                  {erroDeInicio.podeLiberar && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void executar(true)}
                    >
                      Sei do risco — enviar mesmo assim
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-1.5">
              <Button
                className="w-full gap-2"
                size="lg"
                disabled={motivoParaNaoEnviar !== null || agendando}
                onClick={() => setConfirmando(true)}
              >
                {agendar ? <CalendarClock className="size-4" aria-hidden /> : <Send className="size-4" aria-hidden />}
                {agendar ? (agendando ? 'Agendando…' : 'Agendar para') : 'Enviar para'} {alvos.length} {alvos.length === 1 ? 'grupo' : 'grupos'}
              </Button>
              {motivoParaNaoEnviar && alvos.length > 0 && (
                <p className="text-center text-xs text-muted-foreground">{motivoParaNaoEnviar}</p>
              )}
            </div>
          </>
        )}
      </section>

      <ConfirmBulkDialog
        aberto={confirmando}
        aoMudar={setConfirmando}
        titulo={`${agendar ? 'Agendar para' : 'Enviar para'} ${alvos.length} ${alvos.length === 1 ? 'grupo' : 'grupos'}?`}
        descricao={agendar
          ? `${ROTULO_DA_ACAO[campos.acao]} em ${formatarEmBrasilia(campos.quando)} (Brasília), a partir de ${instanceName}.`
          : `“${resumoDoRascunho(rascunho)}” — a partir de ${instanceName}.`}
        grupos={alvos.map((jid) => nomes.get(jid) ?? jid)}
        exigirDigitar={agendar
          ? exigeConfirmacaoDoAgendamento(campos.acao === 'mensagem' ? 'send_text' : 'update_name', marcandoTodos, alvos.length)
          : exigeConfirmacaoDigitada(marcarTodos, alvos.length)}
        textoDoBotao={agendar ? 'Agendar' : 'Enviar'}
        aoConfirmar={aoConfirmar}
      >
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Intervalo de {espacamentoEfetivo} s entre grupos (com pequena variação).</li>
          {alvos.length > 1 && (
            <li>
              Duração estimada: cerca de {duracao}.{' '}
              {agendar ? 'Pode fechar esta aba: o painel executa sozinho.' : 'Mantenha esta aba aberta.'}
            </li>
          )}
          {agendar && campos.acao !== 'mensagem' && (
            <li className="text-amber-400">Vale o que está digitado agora, mesmo que o grupo mude até lá.</li>
          )}
          {marcandoTodos && (
            <li className="text-amber-400">
              Todos os participantes de cada grupo serão notificados.
            </li>
          )}
        </ul>
      </ConfirmBulkDialog>
    </div>
  )
}
