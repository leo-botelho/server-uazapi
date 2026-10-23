import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * GET  /api/groups/runs/[runId] — o resultado grupo a grupo de uma ocorrência.
 * POST /api/groups/runs/[runId] — `{ acao: 'repetir', incluirIncertos?: boolean }`.
 *
 * Repetir recoloca na fila os itens que FALHARAM. Os "incertos" (o WhatsApp não
 * respondeu a tempo, ou a passada foi interrompida durante o envio) ficam de
 * fora por padrão: a mensagem pode ter sido entregue, e repetir seria mandá-la
 * duas vezes no mesmo grupo. A tela avisa e deixa o operador decidir.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const { runId } = await params
  const db = await createServiceClient()

  const { data: ocorrencia } = await db
    .from('group_task_runs')
    .select('id, task_id, run_at, status, total, succeeded, failed, blocked_reason')
    .eq('id', runId)
    .maybeSingle()

  if (!ocorrencia) return NextResponse.json({ error: 'Ocorrência não encontrada.' }, { status: 404 })

  const { data: itens, error } = await db
    .from('group_task_items')
    .select('id, group_jid, seq, not_before, status, error, executed_at, response')
    .eq('run_id', runId)
    .order('seq', { ascending: true })
    .limit(300)

  if (error) {
    console.error('[groups/runs] falha ao ler os itens:', error.message)
    return NextResponse.json({ error: 'Erro ao consultar o banco.' }, { status: 500 })
  }

  // Nome do grupo: o JID sozinho não diz nada a quem lê o relatório.
  const { data: tarefa } = await db.from('group_tasks').select('instance_id').eq('id', ocorrencia.task_id).maybeSingle()
  const nomes = new Map<string, string>()
  if (tarefa && (itens ?? []).length > 0) {
    const { data: grupos } = await db
      .from('group_cache')
      .select('group_jid, name')
      .eq('instance_id', tarefa.instance_id)
      .in('group_jid', (itens ?? []).map((i) => i.group_jid))
    for (const g of grupos ?? []) if (g.name) nomes.set(g.group_jid, g.name)
  }

  return NextResponse.json({
    ocorrencia,
    itens: (itens ?? []).map((i) => {
      const resposta = (i.response ?? {}) as Record<string, unknown>
      return {
        id: i.id,
        groupjid: i.group_jid,
        nome: nomes.get(i.group_jid) ?? null,
        status: i.status,
        prevista: i.not_before,
        executadaEm: i.executed_at,
        erro: i.error,
        incerto: resposta.incerto === true,
      }
    }),
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const { runId } = await params

  let corpo: { acao?: unknown; incluirIncertos?: unknown }
  try {
    corpo = (await request.json()) as typeof corpo
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }
  if (corpo.acao !== 'repetir') return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })

  const db = await createServiceClient()

  // Repetir numa tarefa pausada, cancelada ou bloqueada reativaria algo que o
  // operador parou de propósito.
  const { data: ocorrencia } = await db.from('group_task_runs').select('task_id').eq('id', runId).maybeSingle()
  if (!ocorrencia) return NextResponse.json({ error: 'Ocorrência não encontrada.' }, { status: 404 })

  const { data: tarefa } = await db.from('group_tasks').select('status').eq('id', ocorrencia.task_id).maybeSingle()
  if (!tarefa || !['scheduled', 'running', 'done'].includes(tarefa.status)) {
    return NextResponse.json(
      { error: 'Este agendamento está pausado, bloqueado ou cancelado. Retome-o antes de repetir.' },
      { status: 409 }
    )
  }

  const r = await db.rpc('retry_failed_group_items', {
    p_run: runId,
    p_include_uncertain: corpo.incluirIncertos === true,
  })

  if (r.error) {
    console.error('[groups/runs] falha ao repetir:', r.error.message)
    return NextResponse.json({ error: 'Não foi possível repetir as falhas.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, repetidos: r.data ?? 0 })
}
