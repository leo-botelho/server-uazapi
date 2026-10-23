'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * O motor do envio pelo navegador.
 *
 * O navegador é quem espera entre um grupo e o próximo: é o limitador mais
 * barato e mais exato (zero tempo de Worker), com feedback instantâneo. Mas a
 * aba precisa ficar aberta — por isso há um teto de 20 grupos e um aviso ao
 * tentar fechar.
 *
 * Nada aqui é fronteira de segurança. O servidor recusa o que viola as regras
 * (`dispatch/one` confere espaçamento, seleção e permissão a cada grupo); este
 * laço só obedece e mostra o que aconteceu.
 */

export type EstadoDoGrupo = 'aguardando' | 'enviando' | 'enviado' | 'falhou'

export interface ResultadoDoGrupo {
  estado: EstadoDoGrupo
  erro?: string
}

export type Fase = 'ocioso' | 'enviando' | 'concluido' | 'interrompido'

export interface ErroDeInicio {
  erro: string
  bloqueado?: boolean
  tipoDeBloqueio?: 'desconectada' | 'restricao' | 'cota'
  podeLiberar?: boolean
  ate?: string
  migracaoPendente?: boolean
}

export interface ConfigDoEnvio {
  instanceId: string
  targetJids: string[]
  kind: string
  payload: Record<string, unknown>
  marcarTodos: boolean
  espacamentoS: number
  jitterPct: number
  liberarCota?: boolean
}

export interface EstadoDoEnvio {
  fase: Fase
  runId: string | null
  progresso: Record<string, ResultadoDoGrupo>
  /** Quanto falta (ms) até o próximo grupo, ou null quando não está esperando. */
  esperaRestanteMs: number | null
  /** Mensagem geral da execução (interrompida, restrição do WhatsApp…). */
  aviso: string | null
}

const ESTADO_INICIAL: EstadoDoEnvio = {
  fase: 'ocioso',
  runId: null,
  progresso: {},
  esperaRestanteMs: null,
  aviso: null,
}

/** Tentativas ao receber 429 (o servidor pediu para esperar mais). */
const MAX_TENTATIVAS_429 = 3

const TICK_MS = 250

interface RespostaDeInicio {
  error?: string
  runId?: string
  bloqueado?: boolean
  tipoDeBloqueio?: ErroDeInicio['tipoDeBloqueio']
  podeLiberar?: boolean
  ate?: string
  migracaoPendente?: boolean
}

interface RespostaDeItem {
  error?: string
  bloqueado?: boolean
  encerrada?: boolean
  jaProcessado?: boolean
  espacamentoNaoRespeitado?: boolean
  tentarDeNovoEmMs?: number
  item?: { status: 'sent' | 'failed'; error?: string }
  proximaEsperaMs?: number
}

type DefineEstado = React.Dispatch<React.SetStateAction<EstadoDoEnvio>>

/** Espera `ms`, atualizando a contagem regressiva, e sai cedo se pedirem parada. */
async function esperar(ms: number, parar: { current: boolean }, setEstado: DefineEstado) {
  const fim = Date.now() + ms
  while (!parar.current) {
    const resta = fim - Date.now()
    if (resta <= 0) break
    setEstado((e) => ({ ...e, esperaRestanteMs: resta }))
    await new Promise((r) => setTimeout(r, Math.min(TICK_MS, resta)))
  }
  setEstado((e) => ({ ...e, esperaRestanteMs: null }))
}

export function useDispatch() {
  const [estado, setEstado] = useState<EstadoDoEnvio>(ESTADO_INICIAL)
  const [erroDeInicio, setErroDeInicio] = useState<ErroDeInicio | null>(null)

  // Pedido de parada. Num ref porque o laço assíncrono precisa ler o valor
  // ATUAL a cada volta, não o capturado quando ele começou.
  const parar = useRef(false)

  // Fechar a aba no meio do envio deixa grupos sem mensagem e o operador sem
  // saber quais. O navegador pergunta antes.
  const enviando = estado.fase === 'enviando'
  useEffect(() => {
    if (!enviando) return

    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [enviando])

  const pedirParada = useCallback(() => {
    parar.current = true
  }, [])

  const reiniciar = useCallback(() => {
    setEstado(ESTADO_INICIAL)
    setErroDeInicio(null)
  }, [])

  const iniciar = useCallback(async (config: ConfigDoEnvio): Promise<boolean> => {
    parar.current = false
    setErroDeInicio(null)

    const inicial: Record<string, ResultadoDoGrupo> = Object.fromEntries(
      config.targetJids.map((jid) => [jid, { estado: 'aguardando' } as ResultadoDoGrupo])
    )
    setEstado({ ...ESTADO_INICIAL, fase: 'enviando', progresso: inicial })

    // ── 1. Abre a execução: o servidor revalida TUDO e grava o conteúdo ─────
    let runId: string
    try {
      const res = await fetch('/api/groups/dispatch/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const corpo = (await res.json()) as RespostaDeInicio

      if (!res.ok || !corpo.runId) {
        setErroDeInicio({
          erro: corpo.error ?? `Falha ao iniciar (${res.status})`,
          bloqueado: corpo.bloqueado,
          tipoDeBloqueio: corpo.tipoDeBloqueio,
          podeLiberar: corpo.podeLiberar,
          ate: corpo.ate,
          migracaoPendente: corpo.migracaoPendente,
        })
        setEstado(ESTADO_INICIAL)
        return false
      }
      runId = corpo.runId
    } catch {
      setErroDeInicio({ erro: 'Sem conexão com o painel. Verifique a internet e tente de novo.' })
      setEstado(ESTADO_INICIAL)
      return false
    }

    setEstado((e) => ({ ...e, runId }))

    // ── 2. Um grupo por vez, com a espera entre eles ────────────────────────
    let interrompido = false
    let aviso: string | null = null

    for (let i = 0; i < config.targetJids.length; i++) {
      if (parar.current) { interrompido = true; break }

      const jid = config.targetJids[i]
      setEstado((e) => ({ ...e, progresso: { ...e.progresso, [jid]: { estado: 'enviando' } } }))

      let corpo: RespostaDeItem | null = null
      let status = 0

      for (let tentativa = 0; tentativa <= MAX_TENTATIVAS_429; tentativa++) {
        try {
          const res = await fetch('/api/groups/dispatch/one', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId, groupjid: jid }),
          })
          status = res.status
          corpo = (await res.json()) as RespostaDeItem
        } catch {
          // Sem resposta NÃO é o mesmo que "não enviou": a mensagem pode ter
          // saído. Parar é o único comportamento seguro.
          setEstado((e) => ({
            ...e,
            progresso: {
              ...e.progresso,
              [jid]: { estado: 'falhou', erro: 'Sem resposta do painel — a mensagem pode ter sido enviada. Confira o grupo.' },
            },
          }))
          aviso = 'A conexão caiu no meio do envio. Confira o último grupo antes de continuar.'
          interrompido = true
          break
        }

        // O servidor pediu para esperar mais: respeita e tenta o MESMO grupo.
        if (status === 429 && corpo.espacamentoNaoRespeitado && tentativa < MAX_TENTATIVAS_429) {
          await esperar(Math.max(500, corpo.tentarDeNovoEmMs ?? 5000), parar, setEstado)
          if (parar.current) { interrompido = true; break }
          continue
        }
        break
      }

      if (interrompido) break
      if (!corpo) break

      // Recusa por regra (4xx): mostra o motivo no grupo e segue para o próximo,
      // exceto quando a execução inteira deixou de valer.
      if (status >= 400) {
        if (corpo.encerrada) {
          aviso = corpo.error ?? 'A execução foi encerrada.'
          interrompido = true
          break
        }
        setEstado((e) => ({
          ...e,
          progresso: { ...e.progresso, [jid]: { estado: 'falhou', erro: corpo?.error ?? `Recusado (${status})` } },
        }))
      } else if (corpo.item) {
        const item = corpo.item
        setEstado((e) => ({
          ...e,
          progresso: {
            ...e.progresso,
            [jid]: item.status === 'sent' ? { estado: 'enviado' } : { estado: 'falhou', erro: item.error },
          },
        }))
      }

      // Restrição do WhatsApp: PARA. Insistir é o que transforma restrição
      // temporária em banimento.
      if (corpo.bloqueado) {
        aviso = corpo.error ?? 'O WhatsApp restringiu os envios deste número. A execução foi interrompida.'
        interrompido = true
        break
      }

      // Espera o intervalo (com a variação) antes do próximo — menos depois do último.
      if (i < config.targetJids.length - 1) {
        await esperar(corpo.proximaEsperaMs ?? config.espacamentoS * 1000, parar, setEstado)
      }
    }

    // ── 3. Encerra a execução no servidor ───────────────────────────────────
    const cancelado = interrompido || parar.current
    try {
      await fetch('/api/groups/dispatch/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, cancelado }),
      })
    } catch {
      // Best effort: a execução abandonada é encerrada pelo próximo `start`.
    }

    setEstado((e) => ({
      ...e,
      fase: cancelado ? 'interrompido' : 'concluido',
      esperaRestanteMs: null,
      aviso: aviso ?? (parar.current ? 'Envio interrompido. Os grupos restantes não receberam a mensagem.' : null),
    }))

    return !cancelado
  }, [])

  return { estado, erroDeInicio, iniciar, pedirParada, reiniciar }
}
