import { NextRequest, NextResponse } from 'next/server'

import { atualizarCacheComGrupo } from '@/lib/groups/cache'
import { resumirParticipantes } from '@/lib/groups/gestao'
import { prepararMutacao, respostaDeErroDaUazapi } from '@/lib/groups/mutacao'

/**
 * POST /api/instances/[id]/groups/info — lê UM grupo ao vivo, com participantes.
 *
 * Corpo: `{ groupjid, convite?: boolean }`. Não exige admin (só lê).
 *
 * Os participantes NUNCA vão para o cache: são dado pessoal. Ficam só na
 * resposta, para a tela desta sessão. A resposta também renova o portão de
 * admin do cache, que é o que libera ou trava as edições.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const preparo = await prepararMutacao(request, params, { exigeAdmin: false })
  if (!preparo.ok) return preparo.resposta

  const { client, token, groupjid, instanceId, corpo } = preparo

  try {
    const grupo = await client.groups.info(token, {
      groupjid,
      getInviteLink: corpo.convite === true,
      // `force`: a tela abre este grupo para AGIR sobre ele; uma cópia velha dos
      // participantes levaria a remover quem já saiu ou a perder quem entrou.
      force: true,
    })

    await atualizarCacheComGrupo(instanceId, grupo)

    return NextResponse.json({
      grupo: {
        jid: grupo.JID,
        nome: grupo.Name ?? null,
        descricao: grupo.Topic ?? null,
        somenteAdminsFalam: grupo.IsAnnounce ?? null,
        somenteAdminsEditam: grupo.IsLocked ?? null,
        aprovacaoParaEntrar: grupo.IsJoinApprovalRequired ?? null,
        quemAdiciona: grupo.MemberAddMode ?? null,
        mensagensTemporarias: grupo.IsEphemeral ? (grupo.DisappearingTimer ?? 0) : 0,
        euSouAdmin: grupo.OwnerIsAdmin ?? null,
        conviteDoGrupo: grupo.invite_link ?? null,
      },
      participantes: resumirParticipantes(grupo),
    })
  } catch (err) {
    return respostaDeErroDaUazapi(err, 'info')
  }
}
