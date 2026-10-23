import { NextRequest, NextResponse } from 'next/server'

import { atualizarCacheComGrupo } from '@/lib/groups/cache'
import {
  LOTE_DE_PARTICIPANTES, resumirParticipantes, resumirResultadoDoLote,
} from '@/lib/groups/gestao'
import { prepararMutacao, respostaDeErroDaUazapi } from '@/lib/groups/mutacao'
import type { UazapiParticipantAction } from '@/lib/uazapi/group-types'

/**
 * POST /api/instances/[id]/groups/participants — remove, promove, rebaixa ou adiciona.
 *
 * Corpo: `{ groupjid, acao: 'remove'|'promote'|'demote'|'add', participantes: string[],
 * incluirAdmins?: boolean }`. Exige admin. UM lote por chamada (até 15): quem
 * percorre os lotes, com a espera entre eles, é a tela.
 *
 * Para remover, promover e rebaixar, os participantes são JIDs que a tela leu do
 * próprio grupo. A rota ainda REBUSCA o grupo ao vivo e confere cada um:
 *  - quem não está mais no grupo é descartado (`naoEstao`) em vez de virar erro;
 *  - admins NÃO são removidos, a não ser que `incluirAdmins` seja `true`
 *    (`protegidos`). Tirar um co-host por engano é o erro caro desta operação.
 *
 * ⚠️ O espaçamento entre lotes NÃO é imposto aqui — fica por conta da tela. Esta
 * operação não tem registro de execução como o envio de mensagens tem. O risco
 * é menor (não notifica ninguém), mas existe: remoção em massa em rajada parece
 * automação para o WhatsApp.
 */

const ACOES = ['remove', 'promote', 'demote', 'add'] as const
type Acao = (typeof ACOES)[number]

const ehJid = (v: string) => /^[0-9a-zA-Z:.-]+@(s\.whatsapp\.net|lid)$/.test(v)

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const preparo = await prepararMutacao(request, params, { exigeAdmin: true })
  if (!preparo.ok) return preparo.resposta

  const { client, token, groupjid, instanceId, corpo } = preparo

  const acao = corpo.acao as Acao
  if (!ACOES.includes(acao)) {
    return NextResponse.json({ error: 'Escolha a ação: remover, promover, rebaixar ou adicionar.' }, { status: 400 })
  }

  const lista = corpo.participantes
  if (!Array.isArray(lista) || lista.length === 0 || !lista.every((p) => typeof p === 'string')) {
    return NextResponse.json({ error: 'Informe os participantes.' }, { status: 400 })
  }
  if (lista.length > LOTE_DE_PARTICIPANTES) {
    return NextResponse.json(
      { error: `No máximo ${LOTE_DE_PARTICIPANTES} participantes por vez.`, limite: LOTE_DE_PARTICIPANTES },
      { status: 400 }
    )
  }

  const pedidos = [...new Set(lista as string[])]

  // Adicionar aceita telefone; as outras ações exigem o JID lido do grupo.
  if (acao === 'add') {
    if (!pedidos.every((p) => /^\d{8,15}$/.test(p))) {
      return NextResponse.json({ error: 'Para adicionar, informe só os dígitos do telefone, com o código do país.' }, { status: 400 })
    }
  } else if (!pedidos.every(ehJid)) {
    return NextResponse.json({ error: 'Participante inválido.' }, { status: 400 })
  }

  try {
    let alvos = pedidos
    const protegidos: string[] = []
    const naoEstao: string[] = []

    if (acao !== 'add') {
      const grupo = await client.groups.info(token, { groupjid, force: true })
      const roster = new Map(resumirParticipantes(grupo).map((p) => [p.jid, p]))

      alvos = []
      for (const jid of pedidos) {
        const p = roster.get(jid)
        if (!p) { naoEstao.push(jid); continue }
        if (acao === 'remove' && p.admin && corpo.incluirAdmins !== true) { protegidos.push(jid); continue }
        if (acao === 'promote' && p.admin) continue   // já é admin: nada a fazer
        alvos.push(jid)
      }
    }

    if (alvos.length === 0) {
      return NextResponse.json({ sucessos: [], falhas: [], protegidos, naoEstao })
    }

    const r = await client.groups.updateParticipants(token, {
      groupjid,
      action: acao as UazapiParticipantAction,
      participants: alvos,
    })

    await atualizarCacheComGrupo(instanceId, r.group)

    const { sucessos, falhas } = resumirResultadoDoLote(r, alvos)
    return NextResponse.json({ sucessos, falhas, protegidos, naoEstao })
  } catch (err) {
    return respostaDeErroDaUazapi(err, 'participants')
  }
}
