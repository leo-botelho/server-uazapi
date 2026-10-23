import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { avaliarAgendamento } from '@/lib/groups/agenda'
import { prefixoDoBucket } from '@/lib/groups/executar'
import type { GrupoConhecido } from '@/lib/groups/dispatch'
import { tabelaNaoExiste, verificarInstalacaoDoAgendador } from '@/lib/groups/install'
import { executarPrevoo } from '@/lib/groups/preflight'
import type { Json } from '@/types/database'

/**
 * POST /api/groups/tasks — agenda uma ação em grupos para uma ou mais datas.
 * GET  /api/groups/tasks?instanceId= — lista os agendamentos da instância.
 *
 * Mesma regra do envio imediato: a tela não é fronteira de segurança. TUDO é
 * revalidado aqui (conteúdo, teto de marcar-todos, espaçamento, permissão em cada
 * grupo, datas) e o que passa fica gravado. O agendador depois só executa o que
 * está no banco, dias depois, sem a tela.
 *
 * Exige a migration 016: sem ela as tarefas seriam criadas e nunca rodariam.
 */

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  let corpo: Record<string, unknown>
  try {
    const bruto = await request.json()
    if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) throw new Error()
    corpo = bruto as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  const instanceId = corpo.instanceId
  if (typeof instanceId !== 'string' || !instanceId) {
    return NextResponse.json({ error: 'Informe a instância.' }, { status: 400 })
  }

  const instalacao = await verificarInstalacaoDoAgendador()
  if (instalacao.estado !== 'ok') {
    return NextResponse.json(
      {
        error: 'O agendador ainda não está instalado: aplique a migration 016 no Supabase.',
        migracaoPendente: true,
      },
      { status: 503 }
    )
  }

  const db = await createServiceClient()

  // ── O que o cache sabe sobre os grupos escolhidos ──────────────────────────
  const jidsPedidos = Array.isArray(corpo.targetJids)
    ? corpo.targetJids.filter((j): j is string => typeof j === 'string').slice(0, 200)
    : []

  const { data: linhas, error: erroDoCache } = await db
    .from('group_cache')
    .select('group_jid, name, owner_can_send, owner_is_admin')
    .eq('instance_id', instanceId)
    .in('group_jid', jidsPedidos)

  if (erroDoCache) {
    if (tabelaNaoExiste(erroDoCache)) {
      return NextResponse.json(
        { error: 'A migration 015 ainda não foi aplicada no banco.', migracaoPendente: true },
        { status: 503 }
      )
    }
    console.error('[groups/tasks] falha ao ler o cache:', erroDoCache.message)
    return NextResponse.json({ error: 'Erro ao consultar o banco.' }, { status: 500 })
  }

  const conhecidos = new Map<string, GrupoConhecido>(
    (linhas ?? []).map((l) => [
      l.group_jid,
      { nome: l.name, podeEnviar: l.owner_can_send, ehAdmin: l.owner_is_admin },
    ])
  )

  // ── As travas ──────────────────────────────────────────────────────────────
  const veredito = avaliarAgendamento(
    {
      name: corpo.name,
      targetJids: corpo.targetJids,
      kind: corpo.kind,
      payload: corpo.payload,
      datas: corpo.datas,
      passos: corpo.passos,
      marcarTodos: corpo.marcarTodos,
      espacamentoS: corpo.espacamentoS,
      jitterPct: corpo.jitterPct,
    },
    conhecidos,
    prefixoDoBucket()
  )

  if (!veredito.ok) {
    return NextResponse.json({ error: veredito.erro, ...veredito.marcadores }, { status: veredito.status })
  }

  const { aprovado } = veredito

  // O pré-voo AVISA, não bloqueia: agendar para depois com o número caído hoje
  // é legítimo. O que bloqueia de verdade é o agendador, na hora de enviar.
  const previo = await executarPrevoo(instanceId).catch(() => null)
  if (previo === null) {
    // `null` também é "instância não encontrada": sem ela não há o que agendar.
    const { data: existe } = await db.from('instances').select('id').eq('id', instanceId).maybeSingle()
    if (!existe) return NextResponse.json({ error: 'Instância não encontrada.' }, { status: 404 })
  }

  // ── Grava a tarefa, os passos e uma ocorrência por data ────────────────────
  const { data: tarefa, error: erroDaTarefa } = await db
    .from('group_tasks')
    .insert({
      instance_id: instanceId,
      name: aprovado.nome,
      target_jids: aprovado.targetJids,
      spacing_seconds: aprovado.espacamentoS,
      spacing_jitter_pct: aprovado.jitterPct,
      mention_all: aprovado.marcarTodos,
      starts_at: aprovado.inicio,
      status: 'scheduled',
      wa_limits_snapshot: (previo?.limites ?? null) as Json | null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (erroDaTarefa || !tarefa) {
    console.error('[groups/tasks] falha ao criar a tarefa:', erroDaTarefa?.message)
    return NextResponse.json({ error: 'Não foi possível criar o agendamento.' }, { status: 500 })
  }

  // Tudo que falhar daqui para a frente apaga a tarefa: ela leva passos e
  // ocorrências junto (ON DELETE CASCADE). Agendamento pela metade seria pior
  // que nenhum — um passo de uma sequência sumiria sem aviso.
  const desfazer = async (motivo: string, mensagem: string) => {
    console.error(`[groups/tasks] ${motivo}`)
    await db.from('group_tasks').delete().eq('id', tarefa.id)
    return NextResponse.json({ error: mensagem }, { status: 500 })
  }

  const { data: passos, error: erroDosPassos } = await db
    .from('group_task_steps')
    .insert(
      aprovado.passos.map((p, i) => ({
        task_id: tarefa.id,
        step_order: i,
        kind: p.conteudo.kind,
        payload: p.conteudo.payload as unknown as Json,
        schedule_mode: p.modo,
        // Passo com atraso relativo não guarda datas: a data dele nasce da âncora.
        ...(p.modo === 'absolute' ? { absolute_ats: p.datas } : { offset_minutes: p.offsetMinutos }),
      }))
    )
    .select('id, step_order')

  if (erroDosPassos || !passos || passos.length !== aprovado.passos.length) {
    return desfazer(`falha ao criar os passos: ${erroDosPassos?.message ?? 'contagem diferente'}`, 'Não foi possível criar o agendamento.')
  }

  const idDoPasso = new Map(passos.map((p) => [p.step_order, p.id]))

  // `resolved_jids` fica vazio de propósito: os alvos são fotografados quando a
  // ocorrência ABRE, e até lá dá para ajustar a tarefa sem reescrever nada.
  const ocorrencias = aprovado.passos.flatMap((p, i) =>
    p.datas.map((quando) => ({
      task_id: tarefa.id,
      step_id: idDoPasso.get(i)!,
      run_at: quando,
      status: 'scheduled' as const,
      total: aprovado.targetJids.length,
    }))
  )

  const { error: erroDasOcorrencias } = await db.from('group_task_runs').insert(ocorrencias)
  if (erroDasOcorrencias) {
    return desfazer(`falha ao criar as ocorrências: ${erroDasOcorrencias.message}`, 'Não foi possível criar o agendamento.')
  }

  return NextResponse.json(
    {
      taskId: tarefa.id,
      passos: aprovado.passos.length,
      ocorrencias: ocorrencias.length,
      inicio: aprovado.inicio,
      avisos: previo?.avisos ?? [],
      // O número está fora do ar ou restrito agora: o agendamento vale, mas vale dizer.
      aviso: previo?.bloqueio ? previo.bloqueio.motivo : null,
    },
    { status: 201 }
  )
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const instanceId = request.nextUrl.searchParams.get('instanceId')
  if (!instanceId) return NextResponse.json({ error: 'Informe a instância.' }, { status: 400 })

  const db = await createServiceClient()

  const { data: tarefas, error } = await db
    .from('group_tasks')
    .select('id, name, target_jids, spacing_seconds, mention_all, status, blocked_reason, created_at')
    .eq('instance_id', instanceId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    if (tabelaNaoExiste(error)) {
      return NextResponse.json({ error: 'A migration 015 ainda não foi aplicada.', migracaoPendente: true }, { status: 503 })
    }
    console.error('[groups/tasks] falha ao listar:', error.message)
    return NextResponse.json({ error: 'Erro ao consultar o banco.' }, { status: 500 })
  }

  const ids = (tarefas ?? []).map((t) => t.id)
  if (ids.length === 0) return NextResponse.json({ tarefas: [] })

  const [{ data: passos }, { data: ocorrencias }] = await Promise.all([
    db.from('group_task_steps').select('id, task_id, step_order, kind, payload, offset_minutes').in('task_id', ids).order('step_order', { ascending: true }),
    db.from('group_task_runs')
      .select('id, task_id, step_id, run_at, status, total, succeeded, failed, blocked_reason')
      .in('task_id', ids)
      .order('run_at', { ascending: true })
      .limit(500),
  ])

  return NextResponse.json({
    tarefas: (tarefas ?? []).map((t) => ({
      id: t.id,
      nome: t.name,
      status: t.status,
      motivoDoBloqueio: t.blocked_reason,
      grupos: t.target_jids.length,
      espacamentoS: t.spacing_seconds,
      marcarTodos: t.mention_all,
      criadaEm: t.created_at,
      passos: (passos ?? []).filter((p) => p.task_id === t.id),
      ocorrencias: (ocorrencias ?? []).filter((o) => o.task_id === t.id),
    })),
  })
}
