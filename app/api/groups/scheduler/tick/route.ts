import { NextRequest, NextResponse } from 'next/server'

import { createServiceClient } from '@/lib/supabase/server'
import { createUazapi, uazapi } from '@/lib/uazapi/client'
import type { UazapiClient } from '@/lib/uazapi/client'
import { atualizarCacheComGrupo } from '@/lib/groups/cache'
import { lerErroDaUazapi } from '@/lib/groups/errors'
import { ConteudoInvalido, executarPasso } from '@/lib/groups/executar'
import {
  HORIZONTE_DO_CLAIM_S, LEASE_MINUTOS, MAX_ITENS_POR_PASSADA, ORCAMENTO_DA_PASSADA_MS,
  decidirItem, esperaAteOHorario, esperaPelaCadencia, funcaoNaoExiste, pisoDeCadenciaMs,
} from '@/lib/groups/scheduler-regras'
import type { Json } from '@/types/database'

/**
 * POST/GET /api/groups/scheduler/tick — a passada do agendador de grupos.
 *
 * Chamada a cada minuto pelo worker `workers/groups-runner`, que só a dispara
 * quando há trabalho (ver o porquê lá). Cada passada:
 *
 *   1. devolve à fila (ou dá por falha) os itens cujo lease venceu;
 *   2. reivindica até MAX_ITENS_POR_PASSADA itens — UMA ida ao banco, que já
 *      materializa as ocorrências vencidas e traz as credenciais;
 *   3. para cada item, em ordem: confere os portões, espera o horário previsto,
 *      reserva o instante da INSTÂNCIA, marca `executed_at` e só então chama a API.
 *
 * O que torna isto seguro de rodar sem ninguém olhando:
 *  - nada é reenviado às cegas: `executed_at` é gravado ANTES da chamada, e um
 *    lease vencido com `executed_at` vira falha "pode ter sido entregue";
 *  - a cadência é do NÚMERO (`reserve_group_instance_slot`), então duas tarefas
 *    na mesma hora nem um atraso do cron geram rajada;
 *  - o erro 463 do WhatsApp bloqueia as tarefas da instância e encerra a passada.
 *
 * Plano Free do Cloudflare: 10 ms de CPU e 50 subrequisições. Dormir é espera de
 * I/O e não conta como CPU; cada item custa ~4 idas externas, por isso o teto de
 * itens. Autenticação: `x-groups-secret` com o valor de GROUPS_RUNNER_SECRET.
 */

/** Mesmo idioma do monitor: um secret gravado por pipeline chega com quebra de linha no fim. */
const limpar = (v: string | undefined | null) => (v ?? '').replace(/\s+/g, '')

const dormir = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function POST(request: NextRequest): Promise<NextResponse> {
  return passada(request)
}

// GET permite testar no navegador e usar agendadores que só fazem GET.
export async function GET(request: NextRequest): Promise<NextResponse> {
  return passada(request)
}

function clienteDaInstancia(item: { server_url: string | null; admin_token: string | null }): UazapiClient {
  // Mesma ordem de getInstanceClient: servidor da instância; senão o das variáveis de ambiente.
  return item.server_url && item.admin_token ? createUazapi(item.server_url, item.admin_token) : uazapi
}

async function passada(request: NextRequest): Promise<NextResponse> {
  const esperado = limpar(process.env.GROUPS_RUNNER_SECRET)

  if (!esperado) {
    console.error('[groups/tick] GROUPS_RUNNER_SECRET não configurado — agendador desabilitado')
    return NextResponse.json(
      { error: 'Agendador não configurado. Defina o secret GROUPS_RUNNER_SECRET no Worker.' },
      { status: 503 }
    )
  }

  const recebido = limpar(request.headers.get('x-groups-secret') ?? request.nextUrl.searchParams.get('secret'))
  if (recebido !== esperado) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const inicio = Date.now()
  const restante = () => ORCAMENTO_DA_PASSADA_MS - (Date.now() - inicio)

  // Tempo por etapa: sem isto "a passada demorou 40 s" não diz se foi sono ou rede.
  const marcos: Record<string, number> = {}
  let ultimo = inicio
  const marcar = (etapa: string) => {
    const agora = Date.now()
    marcos[etapa] = (marcos[etapa] ?? 0) + (agora - ultimo)
    ultimo = agora
  }

  const db = await createServiceClient()

  // ── 1. Lease vencido ───────────────────────────────────────────────────────
  const recuperados = await db.rpc('reclaim_stale_group_items', { p_minutes: LEASE_MINUTOS })
  if (recuperados.error) {
    if (funcaoNaoExiste(recuperados.error)) {
      return NextResponse.json(
        { error: 'A migration 016 ainda não foi aplicada no banco.', migracaoPendente: true },
        { status: 503 }
      )
    }
    console.error('[groups/tick] falha ao recuperar leases:', recuperados.error.message)
  }
  marcar('lease')

  // ── 2. Reivindicar ─────────────────────────────────────────────────────────
  const claim = await db.rpc('claim_group_task_items', {
    p_limit: MAX_ITENS_POR_PASSADA,
    p_lease_minutes: LEASE_MINUTOS,
    p_horizon_seconds: HORIZONTE_DO_CLAIM_S,
  })
  marcar('claim')

  if (claim.error) {
    if (funcaoNaoExiste(claim.error)) {
      return NextResponse.json(
        { error: 'A migration 016 ainda não foi aplicada no banco.', migracaoPendente: true },
        { status: 503 }
      )
    }
    console.error('[groups/tick] falha no claim:', claim.error.message)
    return NextResponse.json({ error: 'Erro ao consultar a fila.' }, { status: 500 })
  }

  const itens = claim.data ?? []
  const resumo = { claimed: itens.length, sent: 0, failed: 0, skipped: 0, released: 0, blocked: false }

  if (itens.length === 0) {
    return NextResponse.json({ ok: true, ...resumo, recuperados: recuperados.data ?? 0, durationMs: Date.now() - inicio, etapasMs: marcos })
  }

  /** Devolve à fila um item que NÃO chegou a ser enviado. */
  const devolver = async (id: number, ate: number) => {
    resumo.released++
    const r = await db.rpc('release_group_task_item', { p_id: id, p_not_before: new Date(ate).toISOString() })
    if (r.error) console.error(`[groups/tick] falha ao devolver o item ${id}:`, r.error.message)
  }

  /** Grava o resultado final de um item que está `running` e é nosso. */
  const concluir = async (
    id: number,
    status: 'sent' | 'failed' | 'skipped',
    erro: string | null,
    resposta: Json
  ) => {
    const r = await db
      .from('group_task_items')
      .update({ status, error: erro, response: resposta, claimed_at: null })
      .eq('id', id)
      .eq('status', 'running')
    if (r.error) console.error(`[groups/tick] ${id} processado, mas o registro falhou:`, r.error.message)
  }

  // ── 3. Os itens, em ordem ──────────────────────────────────────────────────
  let parouPorRestricao = false

  for (const item of itens) {

    // Depois de uma restrição, ou sem orçamento: o que sobrou volta para a fila.
    if (parouPorRestricao || restante() < 3_000) {
      await devolver(item.item_id, Date.parse(item.not_before))
      continue
    }

    // ── Portões e atrasos ────────────────────────────────────────────────────
    const decisao = decidirItem(item, Date.now())

    if (decisao.acao === 'devolver') {
      await devolver(item.item_id, decisao.ate)
      continue
    }

    if (decisao.acao === 'encerrar') {
      const nome = item.group_name ?? item.group_jid
      // Só o portão desta passada tem relação com a execução: nada foi chamado.
      await concluir(item.item_id, decisao.status, `${decisao.erro} (${nome})`, { semChamada: true })
      resumo[decisao.status === 'failed' ? 'failed' : 'skipped']++
      continue
    }

    // ── Espera o horário previsto ────────────────────────────────────────────
    const espera = esperaAteOHorario(item.not_before, Date.now(), restante() - 3_000)
    if (espera.tipo === 'adiar') {
      await devolver(item.item_id, Date.parse(item.not_before))
      continue
    }
    if (espera.tipo === 'dormir') {
      await dormir(espera.ms)
      marcar('sono')
    }

    // ── Cadência do número ───────────────────────────────────────────────────
    const piso = pisoDeCadenciaMs(item)
    let faltam = (await db.rpc('reserve_group_instance_slot', { p_instance: item.instance_id, p_min_ms: piso })).data ?? 0

    if (faltam > 0) {
      const e = esperaPelaCadencia(faltam, restante() - 3_000)
      if (e.tipo === 'dormir') {
        await dormir(e.ms + 50)
        marcar('sono')
        faltam = (await db.rpc('reserve_group_instance_slot', { p_instance: item.instance_id, p_min_ms: piso })).data ?? 0
      }
    }

    if (faltam > 0) {
      // Outra execução da mesma instância acabou de enviar: este item espera a vez.
      await devolver(item.item_id, Date.now() + faltam)
      continue
    }
    marcar('cadencia')

    // ── O portão: nada de enviar item que foi pausado/cancelado enquanto dormíamos ──
    const portao = await db.rpc('begin_group_item_send', { p_id: item.item_id })
    marcar('portao')

    if (portao.error) {
      console.error(`[groups/tick] portão do item ${item.item_id}:`, portao.error.message)
      await devolver(item.item_id, Date.now() + 60_000)
      continue
    }
    if (portao.data !== 'ok') continue   // pausado, cancelado ou já processado: o banco cuidou

    // ── Executa ──────────────────────────────────────────────────────────────
    try {
      const r = await executarPasso(
        clienteDaInstancia(item),
        item.uazapi_token,
        item.kind,
        item.payload,
        item.group_jid,
        item.mention_all
      )
      marcar('api')

      await concluir(item.item_id, 'sent', null, { messageid: r.messageId ?? null })
      resumo.sent++

      if (r.grupo) await atualizarCacheComGrupo(item.instance_id, r.grupo)
    } catch (err) {
      marcar('api')

      if (err instanceof ConteudoInvalido) {
        await concluir(item.item_id, 'failed', err.message, { semChamada: true })
        resumo.failed++
        continue
      }

      const e = lerErroDaUazapi(err)
      console.warn(`[groups/tick] falha em ${item.group_jid}: ${e.corpo.slice(0, 300)}`)

      await concluir(
        item.item_id,
        'failed',
        e.timeout
          // Sem resposta não é o mesmo que "não enviou": a mensagem pode ter saído.
          ? 'O WhatsApp demorou demais para responder. A mensagem pode ter sido entregue — confira o grupo antes de repetir.'
          : e.mensagem,
        { status: e.status, corpo: e.corpo.slice(0, 500), ...(e.timeout ? { incerto: true } : {}) }
      )
      resumo.failed++

      // Insistir num número que o WhatsApp acabou de restringir é o que transforma
      // restrição temporária em banimento.
      if (e.restricaoDoWhatsapp) {
        await db.rpc('block_group_instance_tasks', {
          p_instance: item.instance_id,
          p_reason: 'O WhatsApp restringiu os envios deste número. Retome quando a restrição acabar.',
        })
        resumo.blocked = true
        parouPorRestricao = true
      }
    }
  }

  marcar('fim')

  return NextResponse.json({
    ok: true,
    ...resumo,
    recuperados: recuperados.data ?? 0,
    durationMs: Date.now() - inicio,
    etapasMs: marcos,
  })
}
