import { NextRequest, NextResponse } from 'next/server'

import { atualizarCacheComGrupo } from '@/lib/groups/cache'
import { validarConfiguracao } from '@/lib/groups/gestao'
import { prepararMutacao, respostaDeErroDaUazapi } from '@/lib/groups/mutacao'
import type { UazapiGroup, UazapiGroupMutation } from '@/lib/uazapi/group-types'

/**
 * POST /api/instances/[id]/groups/settings — liga ou desliga UMA configuração.
 *
 * Corpo: `{ groupjid, configuracao, valor }`, com `configuracao` em
 * `announce | locked | joinApproval | memberAddMode | ephemeral`. Exige admin.
 *
 * Uma por vez, de propósito: a tela reflete cada interruptor com o resultado
 * real, e uma falha numa não deixa as outras num estado duvidoso.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const preparo = await prepararMutacao(request, params, { exigeAdmin: true })
  if (!preparo.ok) return preparo.resposta

  const { client, token, groupjid, instanceId, corpo } = preparo

  const v = validarConfiguracao(corpo.configuracao, corpo.valor)
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 })

  const { configuracao, valor } = v.valor

  try {
    let resposta: UazapiGroupMutation
    // O que o cache deve refletir se a resposta não trouxer o grupo atualizado.
    let aoMenos: Partial<UazapiGroup> = {}

    switch (configuracao) {
      case 'announce':
        resposta = await client.groups.updateAnnounce(token, { groupjid, announce: valor as boolean })
        aoMenos = { IsAnnounce: valor as boolean }
        break
      case 'locked':
        resposta = await client.groups.updateLocked(token, { groupjid, locked: valor as boolean })
        aoMenos = { IsLocked: valor as boolean }
        break
      case 'joinApproval':
        // ⚠️ O campo do corpo é PascalCase na uazapiGO.
        resposta = await client.groups.updateJoinApproval(token, {
          groupjid, IsJoinApprovalRequired: valor as boolean,
        })
        aoMenos = { IsJoinApprovalRequired: valor as boolean }
        break
      case 'memberAddMode':
        resposta = await client.groups.updateMemberAddMode(token, {
          groupjid, MemberAddMode: valor as 'admin_add' | 'all_member_add',
        })
        aoMenos = { MemberAddMode: valor as 'admin_add' | 'all_member_add' }
        break
      case 'ephemeral':
        resposta = await client.groups.ephemeral(token, {
          groupjid, duration: valor as 0 | '1d' | '7d' | '90d',
        })
        aoMenos = { IsEphemeral: valor !== 0 }
        break
    }

    await atualizarCacheComGrupo(instanceId, resposta.group ?? { JID: groupjid, ...aoMenos })
    return NextResponse.json({ ok: true, configuracao, valor })
  } catch (err) {
    return respostaDeErroDaUazapi(err, 'settings')
  }
}
