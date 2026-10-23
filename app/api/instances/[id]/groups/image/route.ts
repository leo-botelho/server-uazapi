import { NextRequest, NextResponse } from 'next/server'

import { atualizarCacheComGrupo } from '@/lib/groups/cache'
import { lerErroDaUazapi } from '@/lib/groups/errors'
import { prepararMutacao, respostaDeErroDaUazapi } from '@/lib/groups/mutacao'

/**
 * POST /api/instances/[id]/groups/image — troca ou remove a foto do grupo.
 *
 * Corpo: `{ groupjid, image: 'remove' | <URL pública do bucket group-assets> }`.
 * Exige admin.
 *
 * Só aceita URL do NOSSO bucket. Sem isso, esta rota mandaria a uazapiGO buscar
 * qualquer endereço que viesse na requisição.
 *
 * ⚠️ NÃO verificado contra uma instância real: se a uazapiGO aceita uma URL ou
 * só base64 (a spec lista as duas formas). Por isso tenta a URL primeiro e, se
 * ela recusar por um motivo que NÃO seja permissão/tamanho/formato, reenvia o
 * mesmo arquivo como base64. Uma imagem de 640x640 em JPEG tem dezenas de KB.
 *
 * O arquivo já chega redimensionado (JPEG, até 640x640) pelo navegador — o
 * servidor não decodifica imagem: seria trabalho pesado de CPU no Worker.
 */

/** Erros em que reenviar como base64 não adianta nada. */
const SEM_FALLBACK = new Set([403, 404, 413, 415, 429])

function prefixoDoBucket(): string | null {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\s+/g, '').replace(/\/$/, '')
  return base ? `${base}/storage/v1/object/public/group-assets/` : null
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const preparo = await prepararMutacao(request, params, { exigeAdmin: true })
  if (!preparo.ok) return preparo.resposta

  const { client, token, groupjid, instanceId, corpo } = preparo
  const imagem = corpo.image

  if (typeof imagem !== 'string' || !imagem) {
    return NextResponse.json({ error: 'Informe a imagem.' }, { status: 400 })
  }

  try {
    if (imagem === 'remove') {
      const r = await client.groups.updateImage(token, { groupjid, image: 'remove' })
      await atualizarCacheComGrupo(instanceId, r.group)
      return NextResponse.json({ ok: true, removida: true })
    }

    const prefixo = prefixoDoBucket()
    if (!prefixo || !imagem.startsWith(prefixo)) {
      return NextResponse.json({ error: 'A imagem precisa ter sido enviada pelo painel.' }, { status: 400 })
    }

    let r
    try {
      r = await client.groups.updateImage(token, { groupjid, image: imagem })
    } catch (err) {
      const e = lerErroDaUazapi(err)
      if (e.status !== null && SEM_FALLBACK.has(e.status)) throw err
      if (e.restricaoDoWhatsapp) throw err

      console.warn(`[groups/image] URL recusada (${e.status ?? 'sem status'}); tentando base64`)

      const arquivo = await fetch(imagem, { signal: AbortSignal.timeout(10_000) })
      if (!arquivo.ok) throw new Error(`Não foi possível ler a imagem enviada (${arquivo.status}).`)

      const base64 = Buffer.from(await arquivo.arrayBuffer()).toString('base64')
      r = await client.groups.updateImage(token, { groupjid, image: `data:image/jpeg;base64,${base64}` })
    }

    await atualizarCacheComGrupo(instanceId, r.group)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return respostaDeErroDaUazapi(err, 'image')
  }
}
