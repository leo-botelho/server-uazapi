import { isInstanceStatus, isOffline } from '@/lib/uazapi/types'
import { ehAlteracao } from './agenda'
import { esperaMinimaAceita } from './limits'

/**
 * As decisões de UMA passada do agendador, sem tocar em banco nem em rede.
 *
 * O plano é Free do Cloudflare (10 ms de CPU, 50 subrequisições por chamada), e
 * cada item custa ~4 idas ao banco/API. Os números abaixo saem dessa conta, não
 * de gosto.
 */

/** Itens por passada. 5 × ~4 subrequisições + o claim ≈ 25 de 50, e CPU de sobra. */
export const MAX_ITENS_POR_PASSADA = 5

/** Quanto da passada pode ser gasto dormindo. A passada seguinte do cron pega o resto. */
export const ORCAMENTO_DA_PASSADA_MS = 45_000

/** O claim traz também o que vence dentro deste prazo; a passada dorme até a hora. */
export const HORIZONTE_DO_CLAIM_S = 40

export const LEASE_MINUTOS = 5

/** Instância caída: tenta de novo daqui a tanto, sem gastar tentativa. */
export const ESPERA_INSTANCIA_CAIDA_MS = 5 * 60_000

/**
 * Um item que já deveria ter saído há mais que isto não sai mais: uma promoção
 * de ontem chegando agora é pior que não chegar. (A ocorrência inteira que perde
 * o horário por 60 min é tratada no banco; isto cobre o atraso de cadência e de
 * instância caída.)
 */
export const ATRASO_MAXIMO_DO_ITEM_MS = 2 * 60 * 60_000

/** Quanto vale a pena dormir esperando a cadência liberar, antes de devolver o item. */
export const ESPERA_MAXIMA_PELA_CADENCIA_MS = 15_000

export interface ItemReivindicado {
  item_id: number
  run_id: string
  task_id: string
  group_jid: string
  not_before: string
  kind: string
  instance_id: string
  spacing_seconds: number
  spacing_jitter_pct: number
  owner_is_admin: boolean
  owner_can_send: boolean
  instance_status: string
}

export type Decisao =
  | { acao: 'executar' }
  /** Volta para a fila sem gastar tentativa. */
  | { acao: 'devolver'; ate: number; motivo: string }
  /** Termina sem chamar a API. `status` é o estado terminal do item. */
  | { acao: 'encerrar'; status: 'failed' | 'skipped'; erro: string }

const INSTANCIA_CAIDA = 'A instância estava desconectada no horário.'

/**
 * O que fazer com um item reivindicado, ANTES de esperar ou chamar a API.
 *
 * Os portões de admin e de envio são conferidos AQUI de novo: entre agendar e
 * executar podem ter passado dias, e alguém pode ter tirado o admin do número.
 */
export function decidirItem(item: ItemReivindicado, agora: number): Decisao {
  const prevista = Date.parse(item.not_before)

  if (!Number.isNaN(prevista) && agora - prevista > ATRASO_MAXIMO_DO_ITEM_MS) {
    return {
      acao: 'encerrar',
      status: 'failed',
      erro: 'Perdeu o horário: o envio atrasou mais de 2 horas e foi descartado para não chegar fora de hora.',
    }
  }

  // Estado desconhecido não bloqueia: quem decide de verdade é a API.
  if (isInstanceStatus(item.instance_status) && isOffline(item.instance_status)) {
    return { acao: 'devolver', ate: agora + ESPERA_INSTANCIA_CAIDA_MS, motivo: INSTANCIA_CAIDA }
  }

  if (ehAlteracao(item.kind)) {
    if (!item.owner_is_admin) {
      return {
        acao: 'encerrar',
        status: 'skipped',
        erro: 'O número conectado não é admin deste grupo (nem na última atualização da lista). Nada foi alterado.',
      }
    }
  } else if (!item.owner_can_send) {
    return {
      acao: 'encerrar',
      status: 'skipped',
      erro: 'O número conectado não pode enviar mensagem neste grupo. Nada foi enviado.',
    }
  }

  return { acao: 'executar' }
}

export type Espera =
  | { tipo: 'agora' }
  | { tipo: 'dormir'; ms: number }
  /** Não cabe no que sobra da passada: devolve o item e deixa para a seguinte. */
  | { tipo: 'adiar' }

/** Quanto esperar até o horário previsto do item, dentro do que sobra da passada. */
export function esperaAteOHorario(notBefore: string, agora: number, restanteMs: number): Espera {
  const alvo = Date.parse(notBefore)
  if (Number.isNaN(alvo) || alvo <= agora) return { tipo: 'agora' }

  const falta = alvo - agora
  return falta <= restanteMs ? { tipo: 'dormir', ms: falta } : { tipo: 'adiar' }
}

/**
 * Depois de o banco recusar a cadência, vale esperar? Só se for curto e couber.
 * Senão o item é devolvido com `not_before` no futuro, e a passada segue.
 */
export function esperaPelaCadencia(faltamMs: number, restanteMs: number): Espera {
  if (faltamMs <= 0) return { tipo: 'agora' }
  return faltamMs <= Math.min(ESPERA_MAXIMA_PELA_CADENCIA_MS, restanteMs)
    ? { tipo: 'dormir', ms: faltamMs }
    : { tipo: 'adiar' }
}

/** O piso de cadência que o banco aplica por instância: o mesmo do envio pelo navegador. */
export const pisoDeCadenciaMs = (item: Pick<ItemReivindicado, 'spacing_seconds' | 'spacing_jitter_pct'>) =>
  esperaMinimaAceita(item.spacing_seconds, item.spacing_jitter_pct)

/** Erro do banco por função inexistente: a migration 016 não foi aplicada. */
export function funcaoNaoExiste(erro: { code?: string; message: string }): boolean {
  return (
    erro.code === 'PGRST202' ||   // função fora do schema cache do PostgREST
    erro.code === '42883' ||      // undefined_function
    /Could not find the function|function .* does not exist/i.test(erro.message)
  )
}
