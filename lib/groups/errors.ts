/**
 * Leitura dos erros da uazapiGO.
 *
 * O `request()` do client lança `Error('uazapiGO <status>: <corpo>')` — o status
 * e o corpo chegam achatados numa string. Este módulo desfaz isso na ponta de
 * quem consome, sem mexer no `request` (privado ao closure; mexer nele toca em
 * todo caminho de produção).
 *
 * Se um dia o client passar a lançar um erro tipado, só este arquivo muda.
 */

export interface ErroDaUazapi {
  /** Status HTTP, ou null quando o erro não veio de uma resposta (timeout, rede). */
  status: number | null
  /** Texto bruto devolvido pela API. */
  corpo: string
  /** Mensagem pronta para mostrar. */
  mensagem: string
  /**
   * O WhatsApp restringiu o número (provider_code 463 /
   * WHATSAPP_REACHOUT_TIMELOCK). Insistir transforma restrição temporária em
   * banimento — quem recebe isto TEM que parar de enviar.
   */
  restricaoDoWhatsapp: boolean
  /** O servidor da uazapiGO não respondeu a tempo. */
  timeout: boolean
}

const PADRAO_STATUS = /^uazapiGO (\d{3}):\s*([\s\S]*)$/
const PADRAO_TIMEOUT = /^uazapiGO timeout/

/** Procura os marcadores de restrição no texto bruto (pode ou não ser JSON válido). */
function temMarcadorDeRestricao(texto: string): boolean {
  if (/WHATSAPP_REACHOUT_TIMELOCK/i.test(texto)) return true
  // `"provider_code": 463` com ou sem aspas e espaços.
  return /["']?provider_code["']?\s*[:=]\s*463\b/.test(texto)
}

/** Tenta extrair `message_ptbr` / `error` de um corpo JSON, sem nunca lançar. */
function mensagemDoCorpo(corpo: string): string | null {
  try {
    const json = JSON.parse(corpo) as Record<string, unknown>
    for (const campo of ['message_ptbr', 'provider_message_ptbr', 'error', 'message']) {
      const valor = json[campo]
      if (typeof valor === 'string' && valor.trim()) return valor.trim()
    }
  } catch {
    // corpo não era JSON
  }
  return null
}

export function lerErroDaUazapi(erro: unknown): ErroDaUazapi {
  const texto = erro instanceof Error ? erro.message : String(erro)

  if (PADRAO_TIMEOUT.test(texto)) {
    return {
      status: null,
      corpo: texto,
      mensagem: 'O servidor do WhatsApp demorou demais para responder.',
      restricaoDoWhatsapp: false,
      timeout: true,
    }
  }

  const casou = PADRAO_STATUS.exec(texto)
  if (!casou) {
    return {
      status: null,
      corpo: texto,
      mensagem: texto || 'Erro desconhecido ao falar com o WhatsApp.',
      restricaoDoWhatsapp: temMarcadorDeRestricao(texto),
      timeout: false,
    }
  }

  const status = Number(casou[1])
  const corpo = casou[2]

  return {
    status,
    corpo,
    mensagem: mensagemDoCorpo(corpo) ?? `Erro ${status} da API do WhatsApp.`,
    restricaoDoWhatsapp: temMarcadorDeRestricao(corpo),
    timeout: false,
  }
}

/** Traduz os códigos das mutações de grupo para um motivo legível. */
export function explicarStatusDeGrupo(status: number | null): string | null {
  switch (status) {
    case 403:  return 'O número conectado não é admin deste grupo.'
    case 404:  return 'Grupo não encontrado — o número pode ter saído dele.'
    case 413:  return 'O conteúdo passa do tamanho permitido.'
    case 415:  return 'Formato de arquivo não aceito pelo WhatsApp.'
    case 429:  return 'Limite de envios atingido. Aguarde antes de tentar de novo.'
    default:   return null
  }
}
