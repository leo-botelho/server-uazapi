import { NextResponse } from 'next/server'

import { getInstanceClient, requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import type { UazapiClient } from '@/lib/uazapi/client'
import { explicarStatusDeGrupo, lerErroDaUazapi } from './errors'

/**
 * O que toda rota que mexe num grupo precisa antes de chamar a uazapiGO:
 * login, JID válido, o grupo estar no cache, e — para edições — o número
 * conectado ser admin.
 *
 * O portão de admin lê `group_cache.owner_is_admin`. Esse valor pode estar velho
 * (a pessoa virou admin há pouco), então a recusa aponta para "Atualizar lista"
 * em vez de só dizer não. E a própria uazapiGO continua sendo a última palavra:
 * se o cache disser que sim e o WhatsApp disser 403, o erro volta traduzido.
 */

export type Preparo =
  | {
      ok: true
      instanceId: string
      groupjid: string
      corpo: Record<string, unknown>
      client: UazapiClient
      token: string
    }
  | { ok: false; resposta: NextResponse }

const recusa = (erro: string, status: number, extra?: Record<string, unknown>) => ({
  ok: false as const,
  resposta: NextResponse.json({ error: erro, ...extra }, { status }),
})

const ehJidDeGrupo = (v: unknown): v is string => typeof v === 'string' && /^[0-9-]+@g\.us$/.test(v)

export async function prepararMutacao(
  request: Request,
  params: Promise<{ id: string }>,
  opcoes: { exigeAdmin: boolean }
): Promise<Preparo> {
  const { error: erroDeAuth } = await requireAuth()
  if (erroDeAuth) return { ok: false, resposta: erroDeAuth }

  const { id: instanceId } = await params

  let corpo: Record<string, unknown>
  try {
    const bruto = await request.json()
    if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) throw new Error()
    corpo = bruto as Record<string, unknown>
  } catch {
    return recusa('Corpo da requisição inválido.', 400)
  }

  if (!ehJidDeGrupo(corpo.groupjid)) return recusa('Identificador de grupo inválido.', 400)
  const groupjid = corpo.groupjid

  const db = await createServiceClient()
  const { data: grupo } = await db
    .from('group_cache')
    .select('owner_is_admin')
    .eq('instance_id', instanceId)
    .eq('group_jid', groupjid)
    .maybeSingle()

  if (!grupo) {
    return recusa('Este grupo não está na lista. Atualize a lista de grupos e tente de novo.', 404)
  }

  if (opcoes.exigeAdmin && !grupo.owner_is_admin) {
    return recusa(
      'O número conectado não é admin deste grupo. Se acabou de virar admin, clique em "Atualizar lista" e tente de novo.',
      403,
      { notAdmin: true }
    )
  }

  const resolvida = await getInstanceClient(instanceId)
  if (!resolvida) return recusa('Instância não encontrada.', 404)

  return { ok: true, instanceId, groupjid, corpo, client: resolvida.client, token: resolvida.uazapiToken }
}

export type PreparoDaInstancia =
  | {
      ok: true
      instanceId: string
      userId: string
      corpo: Record<string, unknown>
      client: UazapiClient
      token: string
    }
  | { ok: false; resposta: NextResponse }

/**
 * O que toda rota que age sobre a INSTÂNCIA (não sobre um grupo já conhecido) precisa: login,
 * corpo e cliente da uazapiGO. É o caso de criar grupo, entrar por convite e comunidades.
 */
export async function prepararAcaoDaInstancia(
  request: Request,
  params: Promise<{ id: string }>
): Promise<PreparoDaInstancia> {
  const { user, error: erroDeAuth } = await requireAuth()
  if (erroDeAuth) return { ok: false, resposta: erroDeAuth }

  const { id: instanceId } = await params

  let corpo: Record<string, unknown>
  try {
    const bruto = await request.json()
    if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) throw new Error()
    corpo = bruto as Record<string, unknown>
  } catch {
    return recusa('Corpo da requisição inválido.', 400)
  }

  const resolvida = await getInstanceClient(instanceId)
  if (!resolvida) return recusa('Instância não encontrada.', 404)

  return { ok: true, instanceId, userId: user.id, corpo, client: resolvida.client, token: resolvida.uazapiToken }
}

/** Traduz um erro da uazapiGO para a resposta HTTP, no estilo de marcadores da casa. */
export function respostaDeErroDaUazapi(err: unknown, contexto: string): NextResponse {
  const e = lerErroDaUazapi(err)
  console.warn(`[groups/${contexto}] ${e.corpo.slice(0, 300)}`)

  if (e.restricaoDoWhatsapp) {
    return NextResponse.json(
      { error: 'O WhatsApp restringiu temporariamente este número. Tente mais tarde.', restricao: true },
      { status: 429 }
    )
  }

  const motivo = explicarStatusDeGrupo(e.status)
  const base = motivo ?? (e.timeout ? 'O WhatsApp demorou demais para responder.' : e.mensagem)

  switch (e.status) {
    // 400: a API diz o que recusou (telefone que não parseia, convite inválido…): mostra.
    case 400: return NextResponse.json({ error: base }, { status: 400 })
    case 403: return NextResponse.json({ error: base, notAdmin: true }, { status: 403 })
    case 404: return NextResponse.json({ error: base }, { status: 404 })
    case 413: return NextResponse.json({ error: base, tooLarge: true }, { status: 413 })
    case 415: return NextResponse.json({ error: base, wrongFormat: true }, { status: 415 })
    case 429: return NextResponse.json({ error: base }, { status: 429 })
    default:  return NextResponse.json({ error: base }, { status: 502 })
  }
}
