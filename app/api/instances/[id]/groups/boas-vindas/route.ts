import { NextRequest, NextResponse } from 'next/server'

import { createServiceClient } from '@/lib/supabase/server'
import { MENSAGEM_PADRAO, validarRegra } from '@/lib/groups/boas-vindas'
import { tabelaNaoExiste } from '@/lib/groups/install'
import { prepararMutacao } from '@/lib/groups/mutacao'

/**
 * POST /api/instances/[id]/groups/boas-vindas — lê ou grava a regra de boas-vindas de UM grupo.
 *
 * Corpo: `{ groupjid, acao: 'ler' }` ou
 *        `{ groupjid, acao: 'salvar', enabled, message, delaySeconds }`.
 *
 * Só cuida da REGRA. Quem manda a mensagem é o agendador, a partir do evento `groups` do webhook
 * global (ver `lib/groups/boas-vindas-webhook.ts`). Desligada por padrão: um grupo sem regra
 * salva nunca recebe nada.
 */

const PENDENTE = {
  error: 'A migration 021 (boas-vindas) ainda não foi aplicada no banco.',
  migracaoPendente: true,
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  // Não exige admin: mandar mensagem depende de poder falar no grupo, que o agendador confere.
  const preparo = await prepararMutacao(request, params, { exigeAdmin: false })
  if (!preparo.ok) return preparo.resposta

  const { instanceId, groupjid, corpo } = preparo
  const db = await createServiceClient()

  if (corpo.acao === 'ler') {
    const [{ data: regra, error }, recentes] = await Promise.all([
      db.from('group_welcome_rules')
        .select('enabled, message, delay_seconds')
        .eq('instance_id', instanceId)
        .eq('group_jid', groupjid)
        .maybeSingle(),
      db.from('group_welcome_log')
        .select('id', { count: 'exact', head: true })
        .eq('instance_id', instanceId)
        .eq('group_jid', groupjid)
        .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
    ])

    if (error) {
      if (tabelaNaoExiste(error)) return NextResponse.json(PENDENTE, { status: 503 })
      console.error('[groups/boas-vindas] falha ao ler:', error.message)
      return NextResponse.json({ error: 'Erro ao consultar o banco.' }, { status: 500 })
    }

    return NextResponse.json({
      regra: regra ? { enabled: regra.enabled, message: regra.message, delaySeconds: regra.delay_seconds } : null,
      padrao: MENSAGEM_PADRAO,
      recebidos7dias: recentes.count ?? 0,
    })
  }

  if (corpo.acao === 'salvar') {
    const v = validarRegra({ enabled: corpo.enabled, message: corpo.message, delaySeconds: corpo.delaySeconds })
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 })

    const { error } = await db.from('group_welcome_rules').upsert(
      {
        instance_id: instanceId,
        group_jid: groupjid,
        enabled: v.valor.enabled,
        message: v.valor.message,
        delay_seconds: v.valor.delaySeconds,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'instance_id,group_jid' }
    )

    if (error) {
      if (tabelaNaoExiste(error)) return NextResponse.json(PENDENTE, { status: 503 })
      console.error('[groups/boas-vindas] falha ao salvar:', error.message)
      return NextResponse.json({ error: 'Não foi possível salvar a regra.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, regra: v.valor })
  }

  return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
}
