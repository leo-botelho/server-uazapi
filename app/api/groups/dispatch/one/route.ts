import { NextRequest, NextResponse } from 'next/server'

import { getInstanceClient, requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { avaliarEnvioAoGrupo } from '@/lib/groups/dispatch'
import { enviarPedido } from '@/lib/groups/executar'
import { lerErroDaUazapi } from '@/lib/groups/errors'
import { proximaEspera } from '@/lib/groups/limits'
import { montarPedidoDeEnvio, validarConteudo } from '@/lib/groups/payloads'
import { reservarInstante } from '@/lib/groups/runs'
import type { Json } from '@/types/database'

/**
 * POST /api/groups/dispatch/one — envia a mensagem aprovada para UM grupo.
 *
 * Recebe só `{ runId, groupjid }`. O conteúdo, o espaçamento e o modo de marcar
 * todos vêm do que `dispatch/start` gravou — nunca da requisição. Uma aba
 * adulterada não consegue mandar outro texto, outro grupo nem ir mais rápido.
 *
 * Responde 200 mesmo quando o envio falha (com `item.status: 'failed'`): o
 * navegador precisa continuar para o grupo seguinte, e uma falha num grupo não
 * pode derrubar o resto da execução. Só as recusas de regra voltam com 4xx.
 */

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  let corpo: { runId?: unknown; groupjid?: unknown }
  try {
    corpo = (await request.json()) as typeof corpo
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  const { runId, groupjid } = corpo
  if (typeof runId !== 'string' || typeof groupjid !== 'string' || !runId || !groupjid) {
    return NextResponse.json({ error: 'Informe a execução e o grupo.' }, { status: 400 })
  }

  const db = await createServiceClient()

  // ── O que foi aprovado no início ───────────────────────────────────────────
  const { data: execucao } = await db
    .from('group_task_runs')
    .select('id, task_id, step_id, status, resolved_jids, last_action_at')
    .eq('id', runId)
    .maybeSingle()

  if (!execucao) return NextResponse.json({ error: 'Execução não encontrada.' }, { status: 404 })

  const [{ data: tarefa }, { data: passo }, { data: jaExiste }] = await Promise.all([
    db.from('group_tasks')
      .select('instance_id, spacing_seconds, spacing_jitter_pct, mention_all')
      .eq('id', execucao.task_id)
      .maybeSingle(),
    db.from('group_task_steps')
      .select('kind, payload')
      .eq('id', execucao.step_id)
      .maybeSingle(),
    db.from('group_task_items')
      .select('id')
      .eq('run_id', runId)
      .eq('group_jid', groupjid)
      .maybeSingle(),
  ])

  if (!tarefa || !passo) {
    return NextResponse.json({ error: 'Execução incompleta.' }, { status: 404 })
  }

  const { data: grupo } = await db
    .from('group_cache')
    .select('owner_can_send')
    .eq('instance_id', tarefa.instance_id)
    .eq('group_jid', groupjid)
    .maybeSingle()

  // ── As travas ──────────────────────────────────────────────────────────────
  const agora = Date.now()

  const veredito = avaliarEnvioAoGrupo(
    {
      status: execucao.status,
      jidsResolvidos: execucao.resolved_jids,
      ultimaAcaoEm: execucao.last_action_at,
      espacamentoS: tarefa.spacing_seconds,
      jitterPct: tarefa.spacing_jitter_pct,
    },
    groupjid,
    jaExiste ? 'ja_processado' : 'nenhum',
    grupo?.owner_can_send === true,
    agora
  )

  if (!veredito.ok) {
    return NextResponse.json({ error: veredito.erro, ...veredito.marcadores }, { status: veredito.status })
  }

  // Reserva o instante ANTES de enviar. Se duas requisições chegarem juntas,
  // só uma ganha; a outra volta com 429 e espera.
  const reservou = await reservarInstante(db, runId, new Date(agora).toISOString(), veredito.limiteDeAcao)
  if (!reservou) {
    return NextResponse.json(
      {
        error: 'Outro envio desta execução acabou de sair. Aguarde o intervalo.',
        espacamentoNaoRespeitado: true,
        tentarDeNovoEmMs: 5000,
      },
      { status: 429 }
    )
  }

  // ── Monta o pedido a partir do que está GRAVADO, revalidando ───────────────
  const conteudo = validarConteudo(passo.kind, passo.payload)
  if (!conteudo.ok) {
    return NextResponse.json({ error: `Conteúdo gravado inválido: ${conteudo.erro}` }, { status: 500 })
  }

  const resolvida = await getInstanceClient(tarefa.instance_id)
  if (!resolvida) {
    return NextResponse.json({ error: 'Instância não encontrada.' }, { status: 404 })
  }

  const pedido = montarPedidoDeEnvio(conteudo.conteudo, groupjid, { marcarTodos: tarefa.mention_all })

  // ── Envia ──────────────────────────────────────────────────────────────────
  let status: 'sent' | 'failed' = 'sent'
  let messageId: string | undefined
  let mensagemDeErro: string | null = null
  let restricao = false
  let resposta: Json = {}

  try {
    const r = await enviarPedido(resolvida.client, resolvida.uazapiToken, pedido)
    messageId = r.messageid ?? r.id
    resposta = { messageid: messageId ?? null }
  } catch (err) {
    const e = lerErroDaUazapi(err)
    status = 'failed'
    restricao = e.restricaoDoWhatsapp
    resposta = { status: e.status, corpo: e.corpo.slice(0, 500), ...(e.timeout ? { incerto: true } : {}) }

    mensagemDeErro = e.timeout
      // Sem resposta não é o mesmo que "não enviou": a mensagem pode ter saído.
      ? 'O WhatsApp demorou demais para responder. A mensagem pode ter sido entregue — confira o grupo antes de reenviar.'
      : e.mensagem

    console.warn(`[groups/dispatch/one] falha em ${groupjid}: ${e.corpo.slice(0, 300)}`)
  }

  // ── Registra o resultado ───────────────────────────────────────────────────
  // O item é gravado DEPOIS do envio, já terminal. Gravar antes como `running`
  // seria arriscado: o lease da migration 015 devolveria à fila um item preso
  // e o agendador o reenviaria.
  const { error: erroDoItem } = await db.from('group_task_items').insert({
    run_id: runId,
    group_jid: groupjid,
    seq: (execucao.resolved_jids ?? []).indexOf(groupjid),
    not_before: new Date(agora).toISOString(),
    status,
    attempts: 1,
    executed_at: new Date().toISOString(),
    error: mensagemDeErro,
    response: resposta,
  })

  if (erroDoItem) {
    // A mensagem JÁ saiu. Não dá para desfazer; o registro é que ficou faltando.
    console.error(`[groups/dispatch/one] ${groupjid} enviado, mas o registro falhou:`, erroDoItem.message)
  }

  // Os contadores da ocorrência NÃO são recalculados aqui: seriam mais 3 idas ao
  // banco a cada grupo, e a tela já acompanha o progresso pelo que esta rota
  // devolve. `dispatch/finish` recalcula uma vez no fim. No plano Free do
  // Cloudflare cada chamada externa pesa — são 50 por requisição, e 10 ms de CPU.

  // ── Restrição do WhatsApp: PARA ────────────────────────────────────────────
  // Insistir num número que o WhatsApp acabou de restringir é o que transforma
  // restrição temporária em banimento.
  if (restricao) {
    await db
      .from('group_task_runs')
      .update({
        status: 'blocked_by_wa_limits',
        blocked_reason: 'O WhatsApp restringiu os envios deste número durante a execução.',
      })
      .eq('id', runId)
    await db.from('group_tasks').update({ status: 'blocked' }).eq('id', execucao.task_id)
  }

  return NextResponse.json({
    item: {
      groupjid,
      status,
      ...(messageId ? { messageId } : {}),
      ...(mensagemDeErro ? { error: mensagemDeErro } : {}),
    },
    proximaEsperaMs: proximaEspera(tarefa.spacing_seconds, tarefa.spacing_jitter_pct),
    ...(restricao
      ? { bloqueado: true, error: 'O WhatsApp restringiu os envios deste número. A execução foi interrompida.' }
      : {}),
  })
}
