/**
 * Botões de mensagem (`POST /send/menu` com `type: 'button'`).
 *
 * A uazapiGO não recebe os botões como objetos: eles vão como **strings
 * codificadas** dentro de `choices[]`, usando `|` como separador. Este módulo
 * existe para ninguém montar essa string à mão — um `|` solto no texto do
 * botão quebra a mensagem inteira sem dar erro.
 *
 * Formatos aceitos pela API:
 *   resposta rápida  "texto|id"            (sem id, o id vira o próprio texto)
 *   link             "texto|https://..."   (ou "texto|url:https://...")
 *   copiar           "texto|copy:CODIGO"
 *   ligar            "texto|call:+5511..."
 *
 * ⚠️ Dois avisos vêm da própria spec do uazapiGO:
 *
 *  1. Misturar botão de RESPOSTA com os outros tipos na mesma mensagem faz o
 *     WhatsApp exibir "Não é possível exibir esta mensagem no WhatsApp Web.
 *     Abra o WhatsApp no seu celular para visualizá-la." Quem abrir no
 *     computador não vê nada. Use `misturaQuebraWhatsappWeb()` para avisar na
 *     tela antes de alguém descobrir isso depois de disparar para 40 grupos.
 *
 *  2. "Os recursos de botões interativos e listas podem ser descontinuados a
 *     qualquer momento sem aviso prévio." Botões são instáveis do lado do
 *     WhatsApp; uma campanha agendada para semanas à frente não deve depender
 *     só deles.
 */

export type TipoDeBotao = 'resposta' | 'link' | 'copiar' | 'ligar'

export interface BotaoDeMensagem {
  tipo: TipoDeBotao
  /** O rótulo que aparece no botão. */
  texto: string
  /**
   * O que o botão carrega:
   *   resposta → o id devolvido quando a pessoa toca (opcional)
   *   link     → a URL
   *   copiar   → o texto que vai para a área de transferência
   *   ligar    → o telefone
   */
  valor?: string
}

/**
 * Teto de botões por mensagem.
 *
 * ⚠️ Isto é uma trava NOSSA, não da API: a spec do uazapiGO não documenta
 * máximo nenhum e os exemplos dela chegam a mostrar 4 opções. O limite de 3 é
 * o do WhatsApp para botões de resposta. Se um dia ele mudar, muda aqui.
 */
export const MAX_BOTOES = 3

/** Caracteres que quebram a codificação se aparecerem no texto do botão. */
const SEPARADORES = /[|\n\r]/

export class ErroDeBotao extends Error {}

/** Vira um id estável a partir do rótulo, quando o operador não informou um. */
function idPadrao(texto: string): string {
  const slug = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)

  return slug || 'opcao'
}

function exigirValor(b: BotaoDeMensagem, oQue: string): string {
  const valor = (b.valor ?? '').trim()
  if (!valor) throw new ErroDeBotao(`O botão "${b.texto}" precisa de ${oQue}.`)
  return valor
}

/**
 * Codifica um botão no formato que o `choices[]` espera.
 * Lança `ErroDeBotao` com mensagem pronta para a tela quando algo não serve.
 */
export function codificarBotao(botao: BotaoDeMensagem): string {
  const texto = (botao.texto ?? '').trim()

  if (!texto) {
    throw new ErroDeBotao('Todo botão precisa de um texto.')
  }
  if (SEPARADORES.test(texto)) {
    // `|` é o separador do formato e `\n` é separador alternativo: qualquer um
    // dos dois dentro do rótulo faz a API ler o botão errado.
    throw new ErroDeBotao(
      `O texto do botão não pode conter "|" nem quebra de linha — corrija "${texto}".`
    )
  }

  switch (botao.tipo) {
    case 'resposta': {
      const id = (botao.valor ?? '').trim() || idPadrao(texto)
      if (SEPARADORES.test(id)) {
        throw new ErroDeBotao(`O identificador do botão "${texto}" não pode conter "|".`)
      }
      return `${texto}|${id}`
    }

    case 'link': {
      const url = exigirValor(botao, 'um endereço')
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new ErroDeBotao(`O link do botão "${texto}" não é um endereço válido.`)
      }
      // Só http/https: o WhatsApp não torna clicável nenhum outro esquema, e
      // aceitar `javascript:` aqui seria abrir um buraco de segurança.
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ErroDeBotao(`O link do botão "${texto}" precisa começar com http:// ou https://.`)
      }
      return `${texto}|${parsed.toString()}`
    }

    case 'copiar': {
      const codigo = exigirValor(botao, 'um texto para copiar')
      if (SEPARADORES.test(codigo)) {
        throw new ErroDeBotao(`O código do botão "${texto}" não pode conter "|".`)
      }
      return `${texto}|copy:${codigo}`
    }

    case 'ligar': {
      const telefone = exigirValor(botao, 'um telefone')
      const limpo = telefone.replace(/[^\d+]/g, '')
      if (limpo.replace(/\D/g, '').length < 10) {
        throw new ErroDeBotao(`O telefone do botão "${texto}" parece incompleto.`)
      }
      return `${texto}|call:${limpo}`
    }
  }
}

/**
 * Converte a lista de botões da tela no `choices[]` da API.
 * Valida o conjunto: quantidade, rótulos repetidos e campos obrigatórios.
 */
export function montarChoicesDeBotoes(botoes: BotaoDeMensagem[]): string[] {
  if (botoes.length === 0) {
    throw new ErroDeBotao('Inclua pelo menos um botão.')
  }
  if (botoes.length > MAX_BOTOES) {
    throw new ErroDeBotao(
      `O WhatsApp aceita no máximo ${MAX_BOTOES} botões por mensagem — você colocou ${botoes.length}.`
    )
  }

  const choices = botoes.map(codificarBotao)

  // Dois botões com o mesmo rótulo deixam a pessoa sem saber qual tocou, e no
  // caso de resposta rápida geram o mesmo id.
  const rotulos = botoes.map((b) => b.texto.trim().toLowerCase())
  const repetido = rotulos.find((r, i) => rotulos.indexOf(r) !== i)
  if (repetido) {
    throw new ErroDeBotao(`Há dois botões com o mesmo texto ("${repetido}"). Deixe cada um diferente.`)
  }

  return choices
}

/**
 * A mistura que a spec avisa que quebra: botão de resposta junto com link,
 * copiar ou ligar. Não é motivo para bloquear — pode ser proposital quando o
 * público é todo de celular —, mas tem que aparecer na tela.
 */
export function misturaQuebraWhatsappWeb(botoes: BotaoDeMensagem[]): boolean {
  const temResposta = botoes.some((b) => b.tipo === 'resposta')
  const temOutro = botoes.some((b) => b.tipo !== 'resposta')
  return temResposta && temOutro
}
