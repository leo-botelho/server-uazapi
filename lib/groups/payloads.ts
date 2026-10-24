import { z } from 'zod'

import { MAX_BOTOES, montarChoicesDeBotoes, ErroDeBotao } from './buttons'
import { ATRASO_DIGITANDO_MS } from './limits'

/**
 * O que cada tipo de envio carrega, e como isso vira chamada na uazapiGO.
 *
 * Os schemas são usados nos dois lados: a tela valida antes de mandar e a rota
 * valida de novo, porque a tela não é fronteira de segurança. É também aqui que
 * o limite de 3 botões e a regra de "só http/https" nos links são aplicados.
 */

/** Limite do WhatsApp para o texto de uma mensagem. */
const MAX_TEXTO = 4096

const textoDaMensagem = z
  .string()
  .trim()
  .min(1, 'Escreva a mensagem.')
  .max(MAX_TEXTO, `A mensagem passa de ${MAX_TEXTO} caracteres.`)

export const TIPOS_DE_MIDIA = [
  'image', 'video', 'document', 'audio', 'ptt',
] as const

/** Só endereços que o servidor da uazapiGO consegue buscar. */
const urlPublica = z
  .string()
  .trim()
  .refine((v) => {
    try {
      const u = new URL(v)
      return u.protocol === 'https:' || u.protocol === 'http:'
    } catch {
      return false
    }
  }, 'O arquivo precisa ter um endereço http(s) válido.')

export const payloadTexto = z.object({
  text: textoDaMensagem,
  /** Gera a prévia do primeiro link da mensagem. */
  linkPreview: z.boolean().optional(),
  /**
   * Telefones (só dígitos) a marcar, para mensagens que citam pessoas específicas — as
   * boas-vindas. O texto precisa conter `@<telefone>` de cada um para a menção aparecer.
   * Convive com `marcarTodos`, que prevalece.
   */
  mentions: z.array(z.string().regex(/^\d{8,15}$/, 'Telefone inválido na menção.')).max(20).optional(),
})

export const payloadMidia = z.object({
  type: z.enum(TIPOS_DE_MIDIA),
  /** URL pública do arquivo (vem do upload no bucket `group-assets`). */
  file: urlPublica,
  /** Legenda. Opcional. */
  text: z.string().trim().max(MAX_TEXTO).optional(),
  docName: z.string().trim().max(200).optional(),
  mimetype: z.string().trim().max(100).optional(),
})

// ⚠️ Os tetos de tamanho de rótulo e rodapé abaixo são só de sanidade: a spec
// do uazapiGO não documenta limite de caracteres para botão. Se o WhatsApp
// recusar um rótulo longo, o erro volta da API e aparece no item do grupo.
const botao = z.object({
  tipo: z.enum(['resposta', 'link', 'copiar', 'ligar']),
  texto: z.string().trim().min(1, 'Todo botão precisa de um texto.').max(100, 'O texto do botão está longo demais.'),
  valor: z.string().trim().max(500).optional(),
})

export const payloadBotoes = z.object({
  text: textoDaMensagem,
  footerText: z.string().trim().max(200, 'O rodapé está longo demais.').optional(),
  /** URL de uma imagem exibida acima dos botões. */
  imageButton: urlPublica.optional(),
  buttons: z
    .array(botao)
    .min(1, 'Inclua pelo menos um botão.')
    // ⚠️ O teto de 3 é trava nossa, não da API (a spec não documenta máximo).
    .max(MAX_BOTOES, `O WhatsApp aceita no máximo ${MAX_BOTOES} botões por mensagem.`),
})

export type PayloadTexto = z.infer<typeof payloadTexto>
export type PayloadMidia = z.infer<typeof payloadMidia>
export type PayloadBotoes = z.infer<typeof payloadBotoes>

/** Os tipos de passo que a fase 1 sabe enviar. */
export const TIPOS_DE_ENVIO = ['send_text', 'send_media', 'send_buttons'] as const
export type TipoDeEnvio = (typeof TIPOS_DE_ENVIO)[number]

export function ehTipoDeEnvio(kind: string): kind is TipoDeEnvio {
  return (TIPOS_DE_ENVIO as readonly string[]).includes(kind)
}

export type ConteudoValidado =
  | { kind: 'send_text'; payload: PayloadTexto }
  | { kind: 'send_media'; payload: PayloadMidia }
  | { kind: 'send_buttons'; payload: PayloadBotoes }

export type ResultadoDeValidacao =
  | { ok: true; conteudo: ConteudoValidado }
  | { ok: false; erro: string }

/** Primeira mensagem de erro de um ZodError, já em português. */
function primeiroErro(erro: z.ZodError): string {
  return erro.issues[0]?.message ?? 'Conteúdo inválido.'
}

/**
 * Valida o conteúdo de um envio e devolve uma versão limpa dele.
 * Nunca lança: o erro volta como texto pronto para a tela.
 */
export function validarConteudo(kind: string, payload: unknown): ResultadoDeValidacao {
  switch (kind) {
    case 'send_text': {
      const r = payloadTexto.safeParse(payload)
      return r.success
        ? { ok: true, conteudo: { kind, payload: r.data } }
        : { ok: false, erro: primeiroErro(r.error) }
    }

    case 'send_media': {
      const r = payloadMidia.safeParse(payload)
      return r.success
        ? { ok: true, conteudo: { kind, payload: r.data } }
        : { ok: false, erro: primeiroErro(r.error) }
    }

    case 'send_buttons': {
      const r = payloadBotoes.safeParse(payload)
      if (!r.success) return { ok: false, erro: primeiroErro(r.error) }

      // O zod confere forma e tamanho; a codificação confere o que só ela sabe
      // (`|` no rótulo, link que não é http, telefone curto, rótulo repetido).
      try {
        montarChoicesDeBotoes(r.data.buttons)
      } catch (e) {
        if (e instanceof ErroDeBotao) return { ok: false, erro: e.message }
        throw e
      }
      return { ok: true, conteudo: { kind, payload: r.data } }
    }

    default:
      return { ok: false, erro: `Tipo de envio não suportado: ${kind}` }
  }
}

/** O que será mandado para um grupo, já no formato da chamada na uazapiGO. */
export type PedidoDeEnvio =
  | { via: 'text'; corpo: Parameters<import('@/lib/uazapi/client').UazapiClient['send']['text']>[1] }
  | { via: 'media'; corpo: Parameters<import('@/lib/uazapi/client').UazapiClient['send']['media']>[1] }
  | { via: 'menu'; corpo: Parameters<import('@/lib/uazapi/client').UazapiClient['send']['menu']>[1] }

/**
 * Converte o conteúdo validado no corpo da chamada para UM grupo.
 *
 * `mentions: 'all'` só é incluído quando pedido — em grupo marca todo mundo.
 * `delay` mostra "digitando…" durante a espera, o que parece humano e não custa
 * nada (é em milissegundos).
 */
export function montarPedidoDeEnvio(
  conteudo: ConteudoValidado,
  groupJid: string,
  opcoes: { marcarTodos: boolean }
): PedidoDeEnvio {
  const mentions = opcoes.marcarTodos ? ({ mentions: 'all' } as const) : {}

  switch (conteudo.kind) {
    case 'send_text':
      return {
        via: 'text',
        corpo: {
          number: groupJid,
          text: conteudo.payload.text,
          delay: ATRASO_DIGITANDO_MS,
          ...(conteudo.payload.linkPreview ? { linkPreview: true } : {}),
          ...(conteudo.payload.mentions?.length ? { mentions: conteudo.payload.mentions.join(',') } : {}),
          ...mentions,
        },
      }

    case 'send_media':
      return {
        via: 'media',
        corpo: {
          number: groupJid,
          type: conteudo.payload.type,
          file: conteudo.payload.file,
          delay: ATRASO_DIGITANDO_MS,
          ...(conteudo.payload.text ? { text: conteudo.payload.text } : {}),
          ...(conteudo.payload.docName ? { docName: conteudo.payload.docName } : {}),
          ...(conteudo.payload.mimetype ? { mimetype: conteudo.payload.mimetype } : {}),
          ...mentions,
        },
      }

    case 'send_buttons':
      return {
        via: 'menu',
        corpo: {
          number: groupJid,
          type: 'button',
          text: conteudo.payload.text,
          choices: montarChoicesDeBotoes(conteudo.payload.buttons),
          delay: ATRASO_DIGITANDO_MS,
          ...(conteudo.payload.footerText ? { footerText: conteudo.payload.footerText } : {}),
          ...(conteudo.payload.imageButton ? { imageButton: conteudo.payload.imageButton } : {}),
          ...mentions,
        },
      }
  }
}
