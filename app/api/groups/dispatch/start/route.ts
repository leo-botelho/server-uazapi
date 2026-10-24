import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { avaliarInicio, type GrupoConhecido } from '@/lib/groups/dispatch'
import { avisoDaTravaAntigaDeIntervalo, tabelaNaoExiste } from '@/lib/groups/install'
import { executarPrevoo } from '@/lib/groups/preflight'
import type { Json } from '@/types/database'

/**
 * POST /api/groups/dispatch/start — abre uma execução de envio em massa.
 *
 * É AQUI que tudo que a tela pediu é revalidado (conteúdo, espaçamento, teto de
 * marcar todos, permissão em cada grupo, pré-voo) e que o conteúdo fica
 * gravado. A rota `dispatch/one` depois só envia o que foi aprovado aqui — ela
 * nunca recebe o texto da tela de novo. Assim, uma aba adulterada não consegue
 * mandar uma mensagem diferente da que passou pelas travas.
 *
 * Cria a campanha, o passo e a ocorrência já em `running`. Os items só nascem
 * conforme cada grupo é enviado e já em estado terminal: nenhum fica `pending`
 * ou `running`, então o agendador (fase 3) nunca os reivindica nem os
 * reaproveita pelo lease — o que duplicaria um envio que o navegador já fez.
 */

/** Uma execução sem atividade há mais que isso é considerada abandonada (aba fechada). */
const EXECUCAO_ABANDONADA_APOS_MS = 10 * 60_000

function nomePadrao(): string {
  const quando = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date())
  return `Envio de ${quando}`
}

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

  const db = await createServiceClient()

  // ── O que o cache sabe sobre os grupos escolhidos ──────────────────────────
  const jidsPedidos = Array.isArray(corpo.targetJids)
    ? corpo.targetJids.filter((j): j is string => typeof j === 'string').slice(0, 100)
    : []

  const { data: linhas, error: erroDoCache } = await db
    .from('group_cache')
    .select('group_jid, name, owner_can_send')
    .eq('instance_id', instanceId)
    .in('group_jid', jidsPedidos)

  if (erroDoCache) {
    if (tabelaNaoExiste(erroDoCache)) {
      return NextResponse.json(
        { error: 'A migration 015 ainda não foi aplicada no banco.', migracaoPendente: true },
        { status: 503 }
      )
    }
    console.error('[groups/dispatch/start] falha ao ler o cache:', erroDoCache.message)
    return NextResponse.json({ error: 'Erro ao consultar o banco.' }, { status: 500 })
  }

  const conhecidos = new Map<string, GrupoConhecido>(
    (linhas ?? []).map((l) => [l.group_jid, { nome: l.name, podeEnviar: l.owner_can_send }])
  )

  // ── Pré-voo ────────────────────────────────────────────────────────────────
  const previo = await executarPrevoo(instanceId)
  if (!previo) {
    return NextResponse.json({ error: 'Instância não encontrada.' }, { status: 404 })
  }

  // ── As travas ──────────────────────────────────────────────────────────────
  const veredito = avaliarInicio(
    {
      targetJids: corpo.targetJids,
      kind: corpo.kind,
      payload: corpo.payload,
      marcarTodos: corpo.marcarTodos,
      espacamentoS: corpo.espacamentoS,
      jitterPct: corpo.jitterPct,
      liberarCota: corpo.liberarCota,
      aceitoRiscoMarcarTodos: corpo.aceitoRiscoMarcarTodos,
    },
    conhecidos,
    previo.bloqueio,
    previo.podeForcar
  )

  if (!veredito.ok) {
    return NextResponse.json({ error: veredito.erro, ...veredito.marcadores }, { status: veredito.status })
  }

  const { aprovado } = veredito

  // ── Uma execução por número ────────────────────────────────────────────────
  // O espaçamento é medido DENTRO de cada execução. Duas ao mesmo tempo no
  // mesmo número dobrariam a cadência real sem nenhuma violar a própria regra.
  const { data: tarefasAtivas } = await db
    .from('group_tasks')
    .select('id')
    .eq('instance_id', instanceId)
    .eq('status', 'running')

  const idsAtivos = (tarefasAtivas ?? []).map((t) => t.id)

  if (idsAtivos.length > 0) {
    const { data: execucoes } = await db
      .from('group_task_runs')
      .select('id, task_id, last_action_at, opened_at')
      .in('task_id', idsAtivos)
      .eq('status', 'running')

    const agora = Date.now()
    const vivas = (execucoes ?? []).filter((e) => {
      const ultima = Date.parse(e.last_action_at ?? e.opened_at ?? '')
      return !Number.isNaN(ultima) && agora - ultima < EXECUCAO_ABANDONADA_APOS_MS
    })

    if (vivas.length > 0) {
      return NextResponse.json(
        {
          error:
            'Já há um envio em andamento neste número. Espere ele terminar — ' +
            'dois ao mesmo tempo dobrariam a cadência real de mensagens.',
          execucaoEmAndamento: true,
        },
        { status: 409 }
      )
    }

    // As demais são de abas que foram fechadas no meio: encerra, para não
    // bloquearem o número para sempre.
    const abandonadas = (execucoes ?? []).map((e) => e.id)
    if (abandonadas.length > 0) {
      await db
        .from('group_task_runs')
        .update({ status: 'canceled', blocked_reason: 'Abandonada: a aba foi fechada no meio do envio.' })
        .in('id', abandonadas)
    }
    await db.from('group_tasks').update({ status: 'canceled' }).in('id', idsAtivos)
  }

  // O agendador (fase 3) mantém suas tarefas em `scheduled` enquanto trabalha, então
  // elas não aparecem na checagem acima. O número também não pode receber um envio
  // agendado e um direto ao mesmo tempo.
  const { data: agendadas } = await db
    .from('group_tasks')
    .select('id')
    .eq('instance_id', instanceId)
    .eq('status', 'scheduled')

  if ((agendadas ?? []).length > 0) {
    const { data: emAndamento } = await db
      .from('group_task_runs')
      .select('id')
      .in('task_id', (agendadas ?? []).map((t) => t.id))
      .in('status', ['open', 'running'])
      .limit(1)

    if ((emAndamento ?? []).length > 0) {
      return NextResponse.json(
        {
          error:
            'Há um envio agendado em andamento neste número. Espere ele terminar ou pause o agendamento — ' +
            'os dois ao mesmo tempo dobrariam a cadência real de mensagens.',
          execucaoEmAndamento: true,
          agendamentoEmAndamento: true,
        },
        { status: 409 }
      )
    }
  }

  // ── Grava a campanha, o passo e a ocorrência ───────────────────────────────
  const nome =
    typeof corpo.name === 'string' && corpo.name.trim() ? corpo.name.trim().slice(0, 120) : nomePadrao()

  const { data: tarefa, error: erroDaTarefa } = await db
    .from('group_tasks')
    .insert({
      instance_id: instanceId,
      name: nome,
      target_jids: aprovado.targetJids,
      spacing_seconds: aprovado.espacamentoS,
      spacing_jitter_pct: aprovado.jitterPct,
      mention_all: aprovado.marcarTodos,
      status: 'running',
      wa_limits_snapshot: (previo.limites ?? null) as Json | null,
      created_by: user.id,
    })
    .select('id')
    .single()

  const travaAntiga = avisoDaTravaAntigaDeIntervalo(erroDaTarefa)
  if (travaAntiga) return NextResponse.json({ error: travaAntiga, migracaoPendente: true }, { status: 503 })

  if (erroDaTarefa || !tarefa) {
    console.error('[groups/dispatch/start] falha ao criar a tarefa:', erroDaTarefa?.message)
    return NextResponse.json({ error: 'Não foi possível iniciar o envio.' }, { status: 500 })
  }

  const agoraIso = new Date().toISOString()

  const { data: passo, error: erroDoPasso } = await db
    .from('group_task_steps')
    .insert({
      task_id: tarefa.id,
      step_order: 0,
      kind: aprovado.conteudo.kind,
      payload: aprovado.conteudo.payload as unknown as Json,
      schedule_mode: 'absolute',
      absolute_ats: [agoraIso],
    })
    .select('id')
    .single()

  if (erroDoPasso || !passo) {
    console.error('[groups/dispatch/start] falha ao criar o passo:', erroDoPasso?.message)
    await db.from('group_tasks').delete().eq('id', tarefa.id)
    return NextResponse.json({ error: 'Não foi possível iniciar o envio.' }, { status: 500 })
  }

  const { data: execucao, error: erroDaExecucao } = await db
    .from('group_task_runs')
    .insert({
      task_id: tarefa.id,
      step_id: passo.id,
      run_at: agoraIso,
      resolved_jids: aprovado.targetJids,
      opened_at: agoraIso,
      total: aprovado.targetJids.length,
      status: 'running',
    })
    .select('id')
    .single()

  if (erroDaExecucao || !execucao) {
    console.error('[groups/dispatch/start] falha ao criar a ocorrência:', erroDaExecucao?.message)
    // A tarefa leva passo e ocorrência junto (ON DELETE CASCADE).
    await db.from('group_tasks').delete().eq('id', tarefa.id)
    return NextResponse.json({ error: 'Não foi possível iniciar o envio.' }, { status: 500 })
  }

  return NextResponse.json(
    {
      runId: execucao.id,
      taskId: tarefa.id,
      total: aprovado.targetJids.length,
      espacamentoS: aprovado.espacamentoS,
      jitterPct: aprovado.jitterPct,
      marcarTodos: aprovado.marcarTodos,
      avisos: previo.avisos,
    },
    { status: 201 }
  )
}
