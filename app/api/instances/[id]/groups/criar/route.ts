import { NextRequest, NextResponse } from 'next/server'

import { registrarGrupoNoCache } from '@/lib/groups/cache'
import { grupoDaResposta, validarNovoGrupo } from '@/lib/groups/criar'
import { prepararAcaoDaInstancia, respostaDeErroDaUazapi } from '@/lib/groups/mutacao'

/**
 * POST /api/instances/[id]/groups/criar — cria um grupo com os participantes iniciais.
 *
 * Corpo: `{ nome, telefones, confirmar: true }`. `telefones` é o texto colado (um por linha, ou
 * copiado de planilha): a rota extrai e normaliza, a tela só mostra a prévia.
 *
 * ⚠️ Adicionar à força quem não tem o número salvo é uma das maiores causas de denúncia e de
 * banimento. A rota exige `confirmar: true` por conta própria — a tela não é fronteira de
 * segurança — e o aviso fica na tela, ao lado do botão.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const preparo = await prepararAcaoDaInstancia(request, params)
  if (!preparo.ok) return preparo.resposta

  const { client, token, instanceId, corpo, userId } = preparo

  if (corpo.confirmar !== true) {
    return NextResponse.json({ error: 'Confirme a criação do grupo.', exigeConfirmacao: true }, { status: 400 })
  }

  const v = validarNovoGrupo(corpo.nome, corpo.telefones)
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 })

  const { nome, participantes, ignorados } = v.valor

  try {
    const resposta = await client.groups.create(token, { name: nome, participants: participantes })
    const grupo = grupoDaResposta(resposta)

    console.log(`[groups/criar] ${userId} criou "${nome}" com ${participantes.length} participantes (instância ${instanceId})`)

    if (grupo) await registrarGrupoNoCache(instanceId, grupo, { somosAdmin: true })

    return NextResponse.json(
      {
        ok: true,
        // Sem o JID (resposta num formato que não conhecemos) o grupo FOI criado mesmo assim:
        // a tela manda atualizar a lista em vez de dizer que falhou.
        grupo: grupo ? { jid: grupo.JID, nome: grupo.Name ?? nome, participantes: grupo.Participants?.length ?? null } : null,
        pedidos: participantes.length,
        ignorados,
      },
      { status: 201 }
    )
  } catch (err) {
    return respostaDeErroDaUazapi(err, 'criar')
  }
}
