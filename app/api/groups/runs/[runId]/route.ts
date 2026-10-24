import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { validarReagendamento } from '@/lib/groups/agenda'

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

  let corpo: { acao?: unknown; incluirIncertos?: unknown; quando?: unknown }
  try {
    corpo = (await request.json()) as typeof corpo
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }
  if (corpo.acao !== 'repetir' && corpo.acao !== 'reagendar') {
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  }

  const db = await createServiceClient()

  if (corpo.acao === 'reagendar') return reagendar(db, runId, corpo.quando)

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

/**
 * Muda a hora de UMA execução que ainda não abriu. As mesmas regras da criação (futuro, horizonte,
 * sem invadir as outras execuções da tarefa), e a gravação só vale se a execução AINDA estiver
 * `scheduled` — o filtro do UPDATE é a trava contra o agendador abri-la no meio do caminho.
 */
async function reagendar(
  db: Awaited<ReturnType<typeof createServiceClient>>,
  runId: string,
  quando: unknown
): Promise<NextResponse> {
  const { data: run } = await db
    .from('group_task_runs')
    .select('id, task_id, status')
    .eq('id', runId)
    .maybeSingle()

  if (!run) return NextResponse.json({ error: 'Ocorrência não encontrada.' }, { status: 404 })
  if (run.status !== 'scheduled') {
    return NextResponse.json(
      { error: 'Esta execução já começou (ou terminou): só dá para mudar a hora das que ainda estão aguardando.' },
      { status: 409 }
    )
  }

  const { data: tarefa } = await db
    .from('group_tasks')
    .select('status, spacing_seconds, spacing_jitter_pct, target_jids')
    .eq('id', run.task_id)
    .maybeSingle()

  if (!tarefa || !['scheduled', 'paused', 'blocked'].includes(tarefa.status)) {
    return NextResponse.json({ error: 'Este agendamento já terminou ou foi cancelado.' }, { status: 409 })
  }

  // As demais execuções que ainda ocupam o número: as terminadas não disputam nada.
  const { data: outras } = await db
    .from('group_task_runs')
    .select('run_at')
    .eq('task_id', run.task_id)
    .neq('id', runId)
    .in('status', ['scheduled', 'open', 'running', 'paused', 'blocked_by_wa_limits'])

  const v = validarReagendamento(
    quando,
    (outras ?? []).map((o) => Date.parse(o.run_at)),
    tarefa.target_jids.length,
    tarefa.spacing_seconds,
    tarefa.spacing_jitter_pct
  )
  if (!v.ok) return NextResponse.json({ error: v.erro, ...v.marcadores }, { status: v.status })

  const { data, error } = await db
    .from('group_task_runs')
    .update({ run_at: v.quando })
    .eq('id', runId)
    .eq('status', 'scheduled')
    .select('id')

  if (error) {
    // unique (step_id, run_at): já existe uma execução deste passo exatamente nesse instante.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Já existe uma execução deste passo nesse horário.' }, { status: 409 })
    }
    console.error('[groups/runs] falha ao reagendar:', error.message)
    return NextResponse.json({ error: 'Não foi possível mudar a hora.' }, { status: 500 })
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Esta execução acabou de começar: não dá mais para mudar a hora.' }, { status: 409 })
  }

  return NextResponse.json({ ok: true, quando: v.quando })
}
