import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { executarPrevoo } from '@/lib/groups/preflight'

/**
 * POST /api/groups/tasks/[taskId] — pausar, retomar ou cancelar um agendamento.
 *
 * Corpo: `{ acao: 'pausar' | 'retomar' | 'cancelar' }`.
 *
 * - Pausar: o agendador para de pegar itens dela. O que já estava em voo termina;
 *   o que foi reivindicado e ainda não saiu volta para a fila (o banco confere
 *   isso no portão de envio).
 * - Retomar: reespaça o que sobrou a partir de AGORA (senão tudo que venceu
 *   durante a pausa sairia em rajada). Uma tarefa BLOQUEADA pelo WhatsApp só
 *   retoma se o número não estiver mais restrito.
 * - Cancelar: definitivo.
 */

type Acao = 'pausar' | 'retomar' | 'cancelar'
const ACOES: readonly Acao[] = ['pausar', 'retomar', 'cancelar']

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const { taskId } = await params

  let acao: unknown
  try {
    acao = ((await request.json()) as { acao?: unknown }).acao
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }
  if (typeof acao !== 'string' || !ACOES.includes(acao as Acao)) {
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  }

  const db = await createServiceClient()

  const { data: tarefa } = await db
    .from('group_tasks')
    .select('id, instance_id, status')
    .eq('id', taskId)
    .maybeSingle()

  if (!tarefa) return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 })

  switch (acao as Acao) {
    case 'pausar': {
      if (tarefa.status !== 'scheduled' && tarefa.status !== 'running') {
        return NextResponse.json({ error: 'Só dá para pausar um agendamento ativo.' }, { status: 409 })
      }
      const { error } = await db
        .from('group_tasks')
        .update({ status: 'paused', updated_at: new Date().toISOString() })
        .eq('id', taskId)
        .in('status', ['scheduled', 'running'])
      if (error) return erroDoBanco('pausar', error.message)
      return NextResponse.json({ ok: true, status: 'paused' })
    }

    case 'retomar': {
      if (tarefa.status !== 'paused' && tarefa.status !== 'blocked') {
        return NextResponse.json({ error: 'Só dá para retomar um agendamento pausado ou bloqueado.' }, { status: 409 })
      }

      // Retomar às cegas um número que o WhatsApp acabou de restringir é o que
      // transforma restrição temporária em banimento.
      if (tarefa.status === 'blocked') {
        const previo = await executarPrevoo(tarefa.instance_id).catch(() => null)
        if (previo?.bloqueio && previo.bloqueio.tipo !== 'cota') {
          return NextResponse.json(
            { error: previo.bloqueio.motivo, bloqueado: true, tipoDeBloqueio: previo.bloqueio.tipo },
            { status: 409 }
          )
        }
      }

      const r = await db.rpc('resume_group_task', { p_task: taskId })
      if (r.error) return erroDoBanco('retomar', r.error.message)
      return NextResponse.json({ ok: true, status: 'scheduled', reagendados: r.data ?? 0 })
    }

    case 'cancelar': {
      if (tarefa.status === 'done' || tarefa.status === 'canceled') {
        return NextResponse.json({ error: 'Este agendamento já terminou.' }, { status: 409 })
      }
      const r = await db.rpc('cancel_group_task', { p_task: taskId })
      if (r.error) return erroDoBanco('cancelar', r.error.message)
      return NextResponse.json({ ok: true, status: 'canceled', cancelados: r.data ?? 0 })
    }
  }
}

function erroDoBanco(acao: string, mensagem: string): NextResponse {
  console.error(`[groups/tasks] falha ao ${acao}:`, mensagem)
  return NextResponse.json({ error: 'Não foi possível concluir a ação.' }, { status: 500 })
}
