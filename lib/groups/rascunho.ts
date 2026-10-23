import type { BotaoDeMensagem } from './buttons'
import { validarConteudo, type TipoDeEnvio } from './payloads'

/**
 * O que a pessoa está escrevendo no compositor, antes de virar um envio.
 *
 * Existe separado do payload porque o formulário guarda coisas que a API não
 * conhece (qual aba está aberta, o nome do arquivo para exibir) e porque um
 * rascunho pode estar incompleto — o payload nunca pode.
 */

export type AbaDaMensagem = 'texto' | 'midia' | 'botoes'

export interface MidiaAnexada {
  /** URL pública no bucket `group-assets`. */
  url: string
  nome: string
  mime: string
  tipoDeMidia: 'image' | 'video' | 'audio' | 'document'
}

export interface RascunhoDaMensagem {
  aba: AbaDaMensagem
  texto: string
  linkPreview: boolean
  midia: MidiaAnexada | null
  legenda: string
  botoes: BotaoDeMensagem[]
  rodape: string
  imagemDosBotoes: MidiaAnexada | null
}

export const RASCUNHO_VAZIO: RascunhoDaMensagem = {
  aba: 'texto',
  texto: '',
  linkPreview: false,
  midia: null,
  legenda: '',
  botoes: [{ tipo: 'resposta', texto: '' }],
  rodape: '',
  imagemDosBotoes: null,
}

export interface EnvioMontado {
  kind: TipoDeEnvio
  payload: Record<string, unknown>
}

/** Converte o rascunho no `kind` + `payload` que a API espera. */
export function rascunhoParaEnvio(r: RascunhoDaMensagem): EnvioMontado {
  switch (r.aba) {
    case 'texto':
      return {
        kind: 'send_text',
        payload: { text: r.texto, ...(r.linkPreview ? { linkPreview: true } : {}) },
      }

    case 'midia':
      return {
        kind: 'send_media',
        payload: {
          // A API não tem um tipo "document" distinto de mídia de imagem; o
          // `type` vem do arquivo que foi anexado. Sem arquivo, o payload sai
          // sem `file` e a validação recusa com mensagem clara.
          type: r.midia?.tipoDeMidia ?? 'image',
          file: r.midia?.url ?? '',
          ...(r.legenda.trim() ? { text: r.legenda } : {}),
          ...(r.midia?.tipoDeMidia === 'document'
            ? { docName: r.midia.nome, mimetype: r.midia.mime }
            : {}),
        },
      }

    case 'botoes':
      return {
        kind: 'send_buttons',
        payload: {
          text: r.texto,
          ...(r.rodape.trim() ? { footerText: r.rodape } : {}),
          ...(r.imagemDosBotoes ? { imageButton: r.imagemDosBotoes.url } : {}),
          // Botões vazios no fim da lista são só linhas que a pessoa ainda não
          // preencheu — não devem derrubar a validação do resto.
          buttons: r.botoes.filter((b) => b.texto.trim() !== ''),
        },
      }
  }
}

export type ProblemaDoRascunho = { ok: true } | { ok: false; erro: string }

/** O rascunho já pode ser enviado? Usa a mesma validação da rota. */
export function validarRascunho(r: RascunhoDaMensagem): ProblemaDoRascunho {
  // Mídia: erro mais útil que o do zod ("endereço http inválido") quando o
  // problema é simplesmente não ter anexado nada.
  if (r.aba === 'midia' && !r.midia) return { ok: false, erro: 'Anexe um arquivo.' }

  const { kind, payload } = rascunhoParaEnvio(r)
  const v = validarConteudo(kind, payload)
  return v.ok ? { ok: true } : { ok: false, erro: v.erro }
}

/** Uma prévia curta do que será enviado, para o diálogo de confirmação. */
export function resumoDoRascunho(r: RascunhoDaMensagem): string {
  const corta = (s: string) => (s.length > 140 ? `${s.slice(0, 140).trimEnd()}…` : s)

  switch (r.aba) {
    case 'texto':
      return corta(r.texto.trim())
    case 'midia':
      return `${r.midia?.nome ?? 'arquivo'}${r.legenda.trim() ? ` — ${corta(r.legenda.trim())}` : ''}`
    case 'botoes':
      return `${corta(r.texto.trim())} [${r.botoes.filter((b) => b.texto.trim()).map((b) => b.texto.trim()).join(' · ')}]`
  }
}
