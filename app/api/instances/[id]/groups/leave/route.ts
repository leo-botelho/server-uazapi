import { NextRequest, NextResponse } from 'next/server'

import { createServiceClient } from '@/lib/supabase/server'
import { prepararMutacao, respostaDeErroDaUazapi } from '@/lib/groups/mutacao'

/**
 * POST /api/instances/[id]/groups/leave — o número sai do grupo.
 *
 * Corpo: `{ groupjid, confirmar: true }`. NÃO exige admin (qualquer membro sai).
 *
 * ⚠️ Se o número for o ÚLTIMO admin, o grupo é DISSOLVIDO para todo mundo. Sem
 * volta. Por isso a rota recusa sem `confirmar: true`, e a tela pede para
 * digitar o nome do grupo.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const preparo = await prepararMutacao(request, params, { exigeAdmin: false })
  if (!preparo.ok) return preparo.resposta

  const { client, token, groupjid, instanceId, corpo } = preparo

  if (corpo.confirmar !== true) {
    return NextResponse.json({ error: 'Confirme que quer sair do grupo.' }, { status: 400 })
  }

  try {
    await client.groups.leave(token, { groupjid })

    // Saiu: não faz mais sentido listar este grupo.
    const db = await createServiceClient()
    await db.from('group_cache').delete().eq('instance_id', instanceId).eq('group_jid', groupjid)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return respostaDeErroDaUazapi(err, 'leave')
  }
}
