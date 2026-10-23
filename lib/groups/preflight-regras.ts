import type { WaMessagesLimits } from '@/lib/uazapi/types'

/**
 * Regras do pré-voo: o número pode mandar mensagem agora?
 *
 * Só decisão — nada aqui toca em banco nem em rede. Fica separado de
 * `preflight.ts` (que busca os dados) para dar para testar e para ser
 * importado pela tela sem arrastar código de servidor junto.
 *
 * A escolha de produto foi "trava com aviso": o bloqueio é real, não só um
 * alerta na tela.
 */

export type TipoDeBloqueio =
  /** A instância não está conectada. Sem sessão, nada é enviado. */
  | 'desconectada'
  /** O WhatsApp impôs um bloqueio temporário de envio (`reachout_timelock`). */
  | 'restricao'
  /** A cota de novas conversas esgotou (`can_send_new_messages: false`). */
  | 'cota'

export interface Bloqueio {
  tipo: TipoDeBloqueio
  motivo: string
  /** Até quando dura, quando a API informa. */
  ate?: string
}

export interface ResultadoDoPrevoo {
  conectada: boolean
  limites: WaMessagesLimits | null
  bloqueio: Bloqueio | null
  /**
   * O operador pode seguir mesmo assim?
   *
   * Só para o bloqueio por COTA. A cota é de "novas conversas", e uma mensagem
   * para um grupo em que o número já está provavelmente não conta como conversa
   * nova — então o bloqueio pode ser cauteloso demais, e ainda não foi
   * verificado contra uma instância real. O bloqueio por RESTRIÇÃO nunca é
   * liberável: é um trava global de envio imposta pelo WhatsApp.
   */
  podeForcar: boolean
  avisos: string[]
}

/** Quando a cota passa deste percentual o painel avisa, antes de bloquear. */
const AVISO_DE_COTA_PCT = 80

/**
 * Decide a partir do que a API devolveu. Pura: não toca em rede nem em banco.
 * `limites` null significa que a consulta falhou — nesse caso NÃO bloqueia (não
 * saber não é o mesmo que estar bloqueado), mas avisa.
 */
export function avaliarLimites(
  limites: WaMessagesLimits | null,
  conectada: boolean
): Pick<ResultadoDoPrevoo, 'bloqueio' | 'podeForcar' | 'avisos'> {
  const avisos: string[] = []

  if (!conectada) {
    return {
      bloqueio: {
        tipo: 'desconectada',
        motivo: 'A instância está desconectada. Reconecte o número antes de enviar.',
      },
      podeForcar: false,
      avisos,
    }
  }

  if (!limites) {
    avisos.push('Não foi possível consultar os limites do WhatsApp agora. O envio segue, sem essa verificação.')
    return { bloqueio: null, podeForcar: false, avisos }
  }

  const trava = limites.reachout_timelock
  if (trava?.active === true) {
    return {
      bloqueio: {
        tipo: 'restricao',
        motivo:
          limites.provider_message_ptbr ??
          limites.message_ptbr ??
          'O WhatsApp restringiu temporariamente os envios deste número.',
        ...(trava.until ? { ate: trava.until } : {}),
      },
      podeForcar: false,
      avisos,
    }
  }

  if (limites.can_send_new_messages === false) {
    return {
      bloqueio: {
        tipo: 'cota',
        motivo:
          limites.message_ptbr ??
          'O WhatsApp sinaliza que este número esgotou a cota de novas conversas.',
      },
      podeForcar: true,
      avisos,
    }
  }

  const cota = limites.new_chat_message_capping
  if (cota?.available && cota.total_quota && typeof cota.used_quota === 'number') {
    const usado = (cota.used_quota / cota.total_quota) * 100
    if (usado >= AVISO_DE_COTA_PCT) {
      avisos.push(
        `A cota de novas conversas está em ${cota.used_quota} de ${cota.total_quota}. ` +
        'Perto do limite o WhatsApp passa a restringir o número.'
      )
    }
  }

  // `null` quando o diagnóstico não concluiu: o tipo dos limites diz para não
  // tratar como bloqueado.
  if (limites.can_send_new_messages === null || limites.reachable === false) {
    avisos.push('O diagnóstico de limites do WhatsApp não foi conclusivo.')
  }

  return { bloqueio: null, podeForcar: false, avisos }
}
