import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { recalcularContagem } from '@/lib/groups/runs'

/**
 * POST /api/groups/dispatch/finish — encerra uma execução de envio.
 *
 * Corpo: `{ runId, cancelado?: boolean }`. A tela chama ao terminar o último
 * grupo, ou quando a pessoa aperta "Parar".
 *
 * Idempotente e tolerante: uma execução que o servidor já encerrou sozinho
 * (restrição do WhatsApp) não é reaberta, só tem os números atualizados.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  let corpo: { runId?: unknown; cancelado?: unknown }
  try {
    corpo = (await request.json()) as typeof corpo
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  if (typeof corpo.runId !== 'string' || !corpo.runId) {
    return NextResponse.json({ error: 'Informe a execução.' }, { status: 400 })
  }

  const cancelado = corpo.cancelado === true
  const db = await createServiceClient()

  const { data: execucao } = await db
    .from('group_task_runs')
    .select('id, task_id, status, total')
    .eq('id', corpo.runId)
    .maybeSingle()

  if (!execucao) return NextResponse.json({ error: 'Execução não encontrada.' }, { status: 404 })

  const contagem = await recalcularContagem(db, execucao.id, execucao.total)

  // Só encerra o que ainda está rodando. Bloqueada pelo WhatsApp, cancelada ou
  // concluída continuam como estão — o motivo delas não pode ser sobrescrito.
  if (execucao.status === 'running') {
    const statusFinal = cancelado ? 'canceled' : contagem.enviados > 0 ? 'done' : 'failed'

    await db.from('group_task_runs').update({ status: statusFinal }).eq('id', execucao.id)
    await db
      .from('group_tasks')
      .update({ status: cancelado ? 'canceled' : 'done' })
      .eq('id', execucao.task_id)

    return NextResponse.json({ run: { ...contagem, status: statusFinal } })
  }

  return NextResponse.json({ run: { ...contagem, status: execucao.status } })
}
