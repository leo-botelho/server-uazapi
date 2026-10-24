import { NextRequest, NextResponse } from 'next/server'

import { registrarGrupoNoCache } from '@/lib/groups/cache'
import { grupoDaResposta, validarConvite } from '@/lib/groups/criar'
import { prepararAcaoDaInstancia, respostaDeErroDaUazapi } from '@/lib/groups/mutacao'

/**
 * POST /api/instances/[id]/groups/entrar — olha ou entra num grupo por convite.
 *
 * Corpo: `{ convite, acao: 'ver' | 'entrar', confirmar?: true }`.
 *
 *  - `ver`: `inviteInfo`, sem entrar. Mostra o nome e o tamanho antes de a pessoa decidir —
 *    entrar num grupo desconhecido é irreversível do ponto de vista de quem está lá dentro.
 *  - `entrar`: exige `confirmar: true` (a tela não é fronteira de segurança).
 *
 * O convite só é aceito se for de `chat.whatsapp.com` (ou um código puro): um "convite"
 * apontando para outro site é como phishing circula.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const preparo = await prepararAcaoDaInstancia(request, params)
  if (!preparo.ok) return preparo.resposta

  const { client, token, instanceId, corpo, userId } = preparo

  const convite = validarConvite(corpo.convite)
  if (!convite.ok) return NextResponse.json({ error: convite.erro }, { status: 400 })

  if (corpo.acao !== 'ver' && corpo.acao !== 'entrar') {
    return NextResponse.json({ error: 'Escolha ver ou entrar.' }, { status: 400 })
  }

  try {
    if (corpo.acao === 'ver') {
      const grupo = grupoDaResposta(await client.groups.inviteInfo(token, { invitecode: convite.valor }))
      if (!grupo) return NextResponse.json({ error: 'O WhatsApp não devolveu os dados deste grupo.' }, { status: 502 })

      return NextResponse.json({
        grupo: {
          jid: grupo.JID,
          nome: grupo.Name ?? null,
          descricao: grupo.Topic ?? null,
          participantes: grupo.Participants?.length ?? null,
          aprovacaoParaEntrar: grupo.IsJoinApprovalRequired ?? null,
        },
      })
    }

    if (corpo.confirmar !== true) {
      return NextResponse.json({ error: 'Confirme a entrada no grupo.', exigeConfirmacao: true }, { status: 400 })
    }

    const resposta = await client.groups.join(token, { invitecode: convite.valor })
    const grupo = grupoDaResposta(resposta)

    console.log(`[groups/entrar] ${userId} entrou no grupo ${grupo?.JID ?? '(sem JID)'} (instância ${instanceId})`)

    // Entrar NÃO faz o número admin: sem `somosAdmin`, a linha nasce travada para edição.
    if (grupo) await registrarGrupoNoCache(instanceId, grupo, { somosAdmin: false })

    return NextResponse.json({
      ok: true,
      grupo: grupo ? { jid: grupo.JID, nome: grupo.Name ?? null } : null,
    })
  } catch (err) {
    return respostaDeErroDaUazapi(err, 'entrar')
  }
}
