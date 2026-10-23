import type { UazapiClient } from '@/lib/uazapi/client'
import type { UazapiGroup } from '@/lib/uazapi/group-types'
import { lerErroDaUazapi } from './errors'
import { montarPedidoDeEnvio, validarConteudo, type PedidoDeEnvio } from './payloads'

/**
 * Executar UMA ação da fila contra a uazapiGO.
 *
 * Usado pelo agendador. As rotas de envio imediato e de foto compartilham as
 * peças daqui (`enviarPedido`, `trocarFotoDoGrupo`), então um ajuste de formato
 * da API é feito num lugar só.
 */

export async function enviarPedido(client: UazapiClient, token: string, pedido: PedidoDeEnvio) {
  switch (pedido.via) {
    case 'text':  return client.send.text(token, pedido.corpo)
    case 'media': return client.send.media(token, pedido.corpo)
    case 'menu':  return client.send.menu(token, pedido.corpo)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Foto do grupo
// ─────────────────────────────────────────────────────────────────────────────

/** Erros em que reenviar como base64 não adianta nada. */
const SEM_FALLBACK = new Set([403, 404, 413, 415, 429])

/** Só imagens do bucket do painel: a uazapiGO nunca é mandada buscar um endereço qualquer. */
export function prefixoDoBucket(): string | null {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\s+/g, '').replace(/\/$/, '')
  return base ? `${base}/storage/v1/object/public/group-assets/` : null
}

/**
 * Troca (ou remove) a foto do grupo.
 *
 * ⚠️ NÃO verificado contra uma instância real: se a uazapiGO aceita URL ou só
 * base64 (a spec lista as duas). Tenta a URL e, se ela recusar por um motivo que
 * NÃO seja permissão/tamanho/formato, reenvia o mesmo arquivo como base64 — uma
 * imagem de 640x640 em JPEG tem dezenas de KB.
 */
export async function trocarFotoDoGrupo(
  client: UazapiClient,
  token: string,
  groupjid: string,
  imagem: string
) {
  if (imagem === 'remove') return client.groups.updateImage(token, { groupjid, image: 'remove' })

  const prefixo = prefixoDoBucket()
  if (!prefixo || !imagem.startsWith(prefixo)) {
    throw new Error('A imagem precisa ter sido enviada pelo painel.')
  }

  try {
    return await client.groups.updateImage(token, { groupjid, image: imagem })
  } catch (err) {
    const e = lerErroDaUazapi(err)
    if (e.status !== null && SEM_FALLBACK.has(e.status)) throw err
    if (e.restricaoDoWhatsapp) throw err

    console.warn(`[groups/foto] URL recusada (${e.status ?? 'sem status'}); tentando base64`)

    const arquivo = await fetch(imagem, { signal: AbortSignal.timeout(10_000) })
    if (!arquivo.ok) throw new Error(`Não foi possível ler a imagem enviada (${arquivo.status}).`)

    const base64 = Buffer.from(await arquivo.arrayBuffer()).toString('base64')
    return client.groups.updateImage(token, { groupjid, image: `data:image/jpeg;base64,${base64}` })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Um passo da fila
// ─────────────────────────────────────────────────────────────────────────────

export interface ResultadoDoPasso {
  messageId?: string
  /** Presente nas alterações: é o que atualiza o cache local. */
  grupo?: UazapiGroup
}

/** O conteúdo gravado não passa mais na validação — falha SEM chamar a API. */
export class ConteudoInvalido extends Error {}

const texto = (v: unknown, campo: string): string => {
  const valor = (v as Record<string, unknown> | null)?.[campo]
  if (typeof valor !== 'string') throw new ConteudoInvalido(`Conteúdo gravado sem o campo “${campo}”.`)
  return valor
}

/**
 * Executa um passo para UM grupo. Revalida o que foi gravado: o agendador roda
 * dias depois de a tarefa ser criada, e não confia no que está no banco só por
 * ter passado pela validação um dia.
 */
export async function executarPasso(
  client: UazapiClient,
  token: string,
  kind: string,
  payload: unknown,
  groupjid: string,
  marcarTodos: boolean
): Promise<ResultadoDoPasso> {
  switch (kind) {
    case 'send_text':
    case 'send_media':
    case 'send_buttons': {
      const conteudo = validarConteudo(kind, payload)
      if (!conteudo.ok) throw new ConteudoInvalido(conteudo.erro)

      const r = await enviarPedido(client, token, montarPedidoDeEnvio(conteudo.conteudo, groupjid, { marcarTodos }))
      return { messageId: r.messageid ?? r.id }
    }

    case 'update_name': {
      const r = await client.groups.updateName(token, { groupjid, name: texto(payload, 'name') })
      return { grupo: r.group }
    }

    case 'update_description': {
      const r = await client.groups.updateDescription(token, { groupjid, description: texto(payload, 'description') })
      return { grupo: r.group }
    }

    case 'update_image': {
      const r = await trocarFotoDoGrupo(client, token, groupjid, texto(payload, 'image'))
      return { grupo: r.group }
    }

    default:
      throw new ConteudoInvalido(`Tipo de ação não suportado pelo agendador: ${kind}`)
  }
}
