import { NextRequest, NextResponse } from 'next/server'

import { atualizarCacheComGrupo } from '@/lib/groups/cache'
import { prepararMutacao, respostaDeErroDaUazapi } from '@/lib/groups/mutacao'

/**
 * POST /api/instances/[id]/groups/invite — vê ou renova o link de convite.
 *
 * Corpo: `{ groupjid, acao: 'ver' | 'resetar' }`. Exige admin.
 *
 * ⚠️ `resetar` INVALIDA o link antigo. Todo link já divulgado deixa de funcionar.
 * A tela confirma antes; a rota exige `confirmar: true` para não depender disso.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const preparo = await prepararMutacao(request, params, { exigeAdmin: true })
  if (!preparo.ok) return preparo.resposta

  const { client, token, groupjid, instanceId, corpo } = preparo

  try {
    if (corpo.acao === 'ver') {
      const g = await client.groups.info(token, { groupjid, getInviteLink: true })
      await atualizarCacheComGrupo(instanceId, g)
      return NextResponse.json({ link: g.invite_link ?? null })
    }

    if (corpo.acao === 'resetar') {
      if (corpo.confirmar !== true) {
        return NextResponse.json(
          { error: 'Renovar o convite invalida o link antigo. Confirme para continuar.' },
          { status: 400 }
        )
      }

      const r = await client.groups.resetInviteCode(token, { groupjid })
      // ⚠️ Aqui o campo é `InviteLink` (I maiúsculo); no objeto `Group` é `invite_link`.
      const link = r.InviteLink ?? r.group?.invite_link ?? null
      await atualizarCacheComGrupo(instanceId, { ...(r.group ?? { JID: groupjid }), invite_link: link ?? undefined })
      return NextResponse.json({ link })
    }

    return NextResponse.json({ error: 'Escolha: ver ou resetar.' }, { status: 400 })
  } catch (err) {
    return respostaDeErroDaUazapi(err, 'invite')
  }
}
