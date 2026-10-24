import { NextRequest, NextResponse } from 'next/server'

import { createServiceClient } from '@/lib/supabase/server'
import { registrarGrupoNoCache } from '@/lib/groups/cache'
import { grupoDaResposta, resumirVinculo, validarNomeDeComunidade, validarVinculo } from '@/lib/groups/criar'
import { prepararAcaoDaInstancia, respostaDeErroDaUazapi } from '@/lib/groups/mutacao'

/**
 * POST /api/instances/[id]/groups/comunidade — cria uma comunidade ou vincula/desvincula grupos.
 *
 * Corpo:
 *  - `{ acao: 'criar', nome, confirmar: true }`
 *  - `{ acao: 'vincular' | 'desvincular', comunidade, grupos: [jid…], confirmar: true }`
 *
 * Vincular e desvincular mexem na estrutura de grupos que já têm gente dentro: a rota exige
 * `confirmar: true` por conta própria. E só age numa comunidade em que o cache diz que o
 * número é admin — o WhatsApp recusaria de qualquer jeito, mas a mensagem daqui é clara.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const preparo = await prepararAcaoDaInstancia(request, params)
  if (!preparo.ok) return preparo.resposta

  const { client, token, instanceId, corpo, userId } = preparo

  if (corpo.confirmar !== true) {
    return NextResponse.json({ error: 'Confirme a ação.', exigeConfirmacao: true }, { status: 400 })
  }

  try {
    // ── Criar ────────────────────────────────────────────────────────────────
    if (corpo.acao === 'criar') {
      const nome = validarNomeDeComunidade(corpo.nome)
      if (!nome.ok) return NextResponse.json({ error: nome.erro }, { status: 400 })

      const resposta = await client.community.create(token, { name: nome.valor })
      const grupo = grupoDaResposta(resposta)

      console.log(`[groups/comunidade] ${userId} criou a comunidade "${nome.valor}" (instância ${instanceId})`)
      if (grupo) await registrarGrupoNoCache(instanceId, { ...grupo, IsParent: grupo.IsParent ?? true }, { somosAdmin: true })

      return NextResponse.json(
        { ok: true, comunidade: grupo ? { jid: grupo.JID, nome: grupo.Name ?? nome.valor } : null },
        { status: 201 }
      )
    }

    // ── Vincular / desvincular ───────────────────────────────────────────────
    if (corpo.acao !== 'vincular' && corpo.acao !== 'desvincular') {
      return NextResponse.json({ error: 'Escolha criar, vincular ou desvincular.' }, { status: 400 })
    }

    const v = validarVinculo(corpo.comunidade, corpo.acao === 'vincular' ? 'add' : 'remove', corpo.grupos)
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 })

    const db = await createServiceClient()
    const { data: linha } = await db
      .from('group_cache')
      .select('owner_is_admin, is_parent')
      .eq('instance_id', instanceId)
      .eq('group_jid', v.valor.comunidade)
      .maybeSingle()

    if (!linha) {
      return NextResponse.json({ error: 'Esta comunidade não está na lista. Atualize a lista de grupos e tente de novo.' }, { status: 404 })
    }
    if (linha.is_parent !== true) {
      return NextResponse.json({ error: 'O grupo escolhido não é uma comunidade.' }, { status: 400 })
    }
    if (!linha.owner_is_admin) {
      return NextResponse.json(
        { error: 'O número conectado não é admin desta comunidade. Se acabou de virar admin, atualize a lista.', notAdmin: true },
        { status: 403 }
      )
    }

    const r = await client.community.editGroups(token, {
      community: v.valor.comunidade,
      action: v.valor.acao,
      groupjids: v.valor.grupos,
    })

    const resumo = resumirVinculo(v.valor.acao, v.valor.grupos.length, r)
    console.log(`[groups/comunidade] ${userId} ${corpo.acao}: ${resumo.mensagem} (instância ${instanceId})`)

    return NextResponse.json({ ok: resumo.falhas === 0, ...resumo, falhados: r.failed ?? [] })
  } catch (err) {
    return respostaDeErroDaUazapi(err, 'comunidade')
  }
}
