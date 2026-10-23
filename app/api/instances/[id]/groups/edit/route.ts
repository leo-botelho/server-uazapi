import { NextRequest, NextResponse } from 'next/server'

import { atualizarCacheComGrupo } from '@/lib/groups/cache'
import { validarDescricaoDoGrupo, validarNomeDoGrupo } from '@/lib/groups/gestao'
import { prepararMutacao, respostaDeErroDaUazapi } from '@/lib/groups/mutacao'

/**
 * POST /api/instances/[id]/groups/edit — troca o nome OU a descrição.
 *
 * Corpo: `{ groupjid, campo: 'name' | 'description', valor: string }`.
 * Exige admin. Os limites (25 e 512 caracteres) são conferidos aqui antes de
 * chamar a uazapiGO, para a tela receber uma mensagem clara em vez de um 413.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const preparo = await prepararMutacao(request, params, { exigeAdmin: true })
  if (!preparo.ok) return preparo.resposta

  const { client, token, groupjid, instanceId, corpo } = preparo

  try {
    if (corpo.campo === 'name') {
      const v = validarNomeDoGrupo(corpo.valor)
      if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 })

      const r = await client.groups.updateName(token, { groupjid, name: v.valor })
      await atualizarCacheComGrupo(instanceId, r.group ?? { JID: groupjid, Name: v.valor })
      return NextResponse.json({ ok: true, valor: v.valor })
    }

    if (corpo.campo === 'description') {
      const v = validarDescricaoDoGrupo(corpo.valor)
      if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 })

      const r = await client.groups.updateDescription(token, { groupjid, description: v.valor })
      await atualizarCacheComGrupo(instanceId, r.group ?? { JID: groupjid, Topic: v.valor })
      return NextResponse.json({ ok: true, valor: v.valor })
    }

    return NextResponse.json({ error: 'Escolha o que editar: nome ou descrição.' }, { status: 400 })
  } catch (err) {
    return respostaDeErroDaUazapi(err, 'edit')
  }
}
