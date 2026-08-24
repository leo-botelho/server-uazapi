import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createUazapi, uazapi } from '@/lib/uazapi/client'
import type { UazapiClient } from '@/lib/uazapi/client'
import { isInstanceStatus, isOffline, type InstanceStatus } from '@/lib/uazapi/types'
import { handleStatusTransition, flushPendingAlerts, type AlertInstance } from '@/lib/notifications'

/**
 * POST/GET /api/monitor/tick — monitor ativo (rede de segurança).
 *
 * Por que existe: até então a ÚNICA fonte de verdade de status era o webhook
 * global do uazapiGO. Quando ele falha — e ele já falhou, ficando `enabled:false`
 * apontando para a URL errada — o painel fica cego e ninguém é avisado até
 * alguém clicar em "Sincronizar" manualmente. Pior: o sync manual nunca
 * disparou alerta nenhum, então o cliente jamais recebia o link de reconexão.
 *
 * O que este endpoint faz a cada execução:
 *  1. Consulta `/instance/all` em cada servidor uazapiGO (1 request por servidor,
 *     traz o status de todas as instâncias de uma vez).
 *  2. Reconcilia com o banco e dispara alertas nas transições — o mesmo caminho
 *     usado pelo webhook, via `lib/notifications`.
 *  3. Reenvia alertas que ficaram pendentes na janela de silêncio.
 *  4. Detecta silêncio do webhook (nenhum evento recebido há muito tempo) e avisa.
 *
 * Autenticação: header `x-monitor-secret` com o valor de `MONITOR_SECRET`.
 * Não usa sessão de admin porque roda sem usuário logado (agendador externo).
 *
 * Agendamento: o worker gerado pelo OpenNext exporta apenas `fetch`, então Cron
 * Trigger do Cloudflare não alcança a aplicação. O agendamento vem de fora —
 * ver `.github/workflows/monitor.yml`.
 */

/** Sem notícia do webhook por mais que isso, algo está errado com a entrega. */
const WEBHOOK_SILENCE_ALERT_MINUTES = 60

export async function POST(request: NextRequest): Promise<NextResponse> {
  return runTick(request)
}

// GET permite testar no navegador e usar agendadores que só fazem GET.
export async function GET(request: NextRequest): Promise<NextResponse> {
  return runTick(request)
}

async function runTick(request: NextRequest): Promise<NextResponse> {
  // Secrets gravados por pipeline costumam carregar uma quebra de linha no
  // fim (um `echo` basta para isso). Comparar sem espacos evita um 401
  // impossivel de diagnosticar.
  const expected = process.env.MONITOR_SECRET?.trim()

  if (!expected) {
    console.error('[monitor] MONITOR_SECRET não configurado — endpoint desabilitado')
    return NextResponse.json(
      { error: 'Monitor não configurado. Defina o secret MONITOR_SECRET no Worker.' },
      { status: 503 }
    )
  }

  const provided = (
    request.headers.get('x-monitor-secret') ??
    request.nextUrl.searchParams.get('secret') ??
    ''
  ).trim()

  if (provided !== expected) {
    // Diagnostico: compara impressoes digitais em vez dos valores. Oito hex
    // de um SHA-256 nao permitem recuperar o secret, mas mostram na hora se
    // o agendador e o Worker estao com valores diferentes.
    const [fpExpected, fpProvided] = await Promise.all([
      fingerprint(expected),
      fingerprint(provided),
    ])
    console.warn(`[monitor] 401 — esperado ${fpExpected} recebido ${fpProvided}`)
    return NextResponse.json(
      { error: 'Unauthorized', expectedFingerprint: fpExpected, providedFingerprint: fpProvided },
      { status: 401 }
    )
  }

  const startedAt = Date.now()
  const supabase  = await createServiceClient()

  // ── 1. Resolve os servidores uazapiGO a consultar ─────────────────────────
  const targets = await resolveServers(supabase)

  if (targets.length === 0) {
    return NextResponse.json(
      { error: 'Nenhum servidor uazapiGO configurado (tabela servers, admin_profiles ou env vars).' },
      { status: 503 }
    )
  }

  // ── 2. Reconcilia cada servidor ───────────────────────────────────────────
  let checked = 0
  let changed = 0
  let alerted = 0
  const errors: string[] = []

  for (const target of targets) {
    try {
      const result = await reconcileServer(supabase, target)
      checked += result.checked
      changed += result.changed
      alerted += result.alerted
    } catch (err) {
      const msg = `${target.label}: ${err instanceof Error ? err.message : String(err)}`
      console.error('[monitor]', msg)
      errors.push(msg)
    }
  }

  // ── 3. Reenvia alertas adiados pela janela de silêncio ────────────────────
  let flushed = 0
  try {
    flushed = await flushPendingAlerts(supabase)
  } catch (err) {
    const msg = `flushPendingAlerts: ${err instanceof Error ? err.message : String(err)}`
    console.error('[monitor]', msg)
    errors.push(msg)
  }

  // ── 4. Watchdog do webhook ────────────────────────────────────────────────
  const webhookSilentFor = await webhookSilenceMinutes(supabase)
  const webhookHealthy   = webhookSilentFor === null || webhookSilentFor < WEBHOOK_SILENCE_ALERT_MINUTES

  if (!webhookHealthy) {
    console.warn(
      `[monitor] ⚠️ Nenhum evento de webhook há ${webhookSilentFor} min. ` +
      'O webhook global pode estar desativado ou apontando para a URL errada — ' +
      'verifique /settings e GET /globalwebhook/errors.'
    )
  }

  // ── 5. Retenção: as tabelas de log cresciam para sempre ───────────────────
  const purged = await purgeOldRecords(supabase)

  const summary = {
    ok: errors.length === 0,
    servers: targets.length,
    checked,
    changed,
    alerted,
    pendingAlertsSent: flushed,
    purged,
    webhook: {
      healthy: webhookHealthy,
      lastEventMinutesAgo: webhookSilentFor,
    },
    durationMs: Date.now() - startedAt,
    ...(errors.length ? { errors } : {}),
  }

  console.log('[monitor] tick:', JSON.stringify(summary))

  return NextResponse.json(summary, { status: errors.length ? 207 : 200 })
}

/** Oito primeiros hex do SHA-256 — identifica o valor sem revela-lo. */
async function fingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].slice(0, 4).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ─────────────────────────────────────────────────────────────────────────────
// Servidores
// ─────────────────────────────────────────────────────────────────────────────

interface ServerTarget {
  label: string
  client: UazapiClient
}

/**
 * Monta a lista de servidores a consultar. Sem sessão de usuário, então lê da
 * tabela `servers`, cai para `admin_profiles` e por fim para as env vars.
 */
async function resolveServers(
  supabase: Awaited<ReturnType<typeof createServiceClient>>
): Promise<ServerTarget[]> {
  const targets: ServerTarget[] = []
  const seen = new Set<string>()

  const { data: servers } = await supabase
    .from('servers')
    .select('name, url, admin_token')
    .eq('active', true)

  for (const s of servers ?? []) {
    if (!s.url || !s.admin_token || seen.has(s.url)) continue
    seen.add(s.url)
    targets.push({ label: s.name ?? s.url, client: createUazapi(s.url, s.admin_token) })
  }

  const { data: profiles } = await supabase
    .from('admin_profiles')
    .select('uazapi_server_url, uazapi_admin_token')
    .neq('uazapi_server_url', '')
    .neq('uazapi_admin_token', '')

  for (const p of profiles ?? []) {
    const url = p.uazapi_server_url
    if (!url || !p.uazapi_admin_token || seen.has(url)) continue
    seen.add(url)
    targets.push({ label: url, client: createUazapi(url, p.uazapi_admin_token) })
  }

  const envUrl = process.env.UAZAPI_BASE_URL
  if (envUrl && process.env.UAZAPI_ADMIN_TOKEN && !seen.has(envUrl)) {
    seen.add(envUrl)
    targets.push({ label: `${envUrl} (env)`, client: uazapi })
  }

  return targets
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliação
// ─────────────────────────────────────────────────────────────────────────────

async function reconcileServer(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  target: ServerTarget
): Promise<{ checked: number; changed: number; alerted: number }> {
  const remote = await target.client.listInstances()

  if (!Array.isArray(remote) || remote.length === 0) {
    return { checked: 0, changed: 0, alerted: 0 }
  }

  // Indexa o estado remoto pelo token de autenticação (a chave usada no banco).
  const remoteByToken = new Map<string, (typeof remote)[number]>()
  for (const inst of remote) {
    const token = inst.token ?? inst.id
    if (token) remoteByToken.set(token, inst)
  }

  const { data: rows, error } = await supabase
    .from('instances')
    .select('id, name, uazapi_token, status, alert_channel, alert_config, silence_start, silence_end, client_id')
    .eq('active', true)
    .in('uazapi_token', [...remoteByToken.keys()])

  if (error) throw new Error(`consulta ao banco falhou: ${error.message}`)

  let checked = 0
  let changed = 0
  let alerted = 0
  const now = new Date().toISOString()

  for (const row of rows ?? []) {
    const inst = remoteByToken.get(row.uazapi_token)
    if (!inst) continue

    checked++

    if (!isInstanceStatus(inst.status)) {
      console.warn(`[monitor] status desconhecido "${String(inst.status)}" em "${row.name}", ignorando`)
      continue
    }

    const previousStatus = row.status as InstanceStatus
    const newStatus      = inst.status

    // Sem mudança: só carimba que a instância foi vista agora. Isso é o que
    // permite ao portal do cliente saber se o dado está fresco.
    if (newStatus === previousStatus) {
      await supabase.from('instances').update({ last_seen_at: now }).eq('id', row.id)
      continue
    }

    const updatePayload: {
      status: InstanceStatus
      last_seen_at: string
      profile_name: string | null
      profile_picture: string | null
      phone_connected?: string | null
      last_disconnected_at?: string
    } = {
      status: newStatus,
      last_seen_at: now,
      profile_name:    inst.profileName   ?? inst.profileInfo?.name    ?? null,
      profile_picture: inst.profilePicUrl ?? inst.profileInfo?.picture ?? null,
    }

    if (newStatus === 'connected') {
      updatePayload.phone_connected = inst.owner ?? inst.phone ?? null
    } else if (newStatus === 'disconnected') {
      updatePayload.phone_connected      = null
      updatePayload.last_disconnected_at = inst.lastDisconnect ?? inst.lastDisconnection ?? now
    } else if (newStatus === 'hibernated') {
      // Credenciais preservadas — mantém o telefone.
      updatePayload.last_disconnected_at = inst.lastDisconnect ?? inst.lastDisconnection ?? now
    }

    // Compare-and-set: se o webhook aplicou a mesma mudança enquanto isso,
    // ele já cuidou do alerta e este ciclo não deve notificar de novo.
    const { data: updated, error: updateError } = await supabase
      .from('instances')
      .update(updatePayload)
      .eq('id', row.id)
      .eq('status', previousStatus)
      .select('id')

    if (updateError) {
      console.error(`[monitor] falha ao atualizar "${row.name}":`, updateError.message)
      continue
    }

    if ((updated?.length ?? 0) === 0) continue

    changed++
    console.log(`[monitor] "${row.name}": ${previousStatus} → ${newStatus}`)

    if (isOffline(newStatus)) {
      try {
        await handleStatusTransition(
          supabase,
          row as AlertInstance,
          previousStatus,
          newStatus,
          inst.lastDisconnectReason ?? 'Detectado pelo monitor ativo'
        )
        alerted++
      } catch (err) {
        console.error(`[monitor] alerta de "${row.name}" falhou:`, err instanceof Error ? err.message : String(err))
      }
    }
  }

  return { checked, changed, alerted }
}

// ─────────────────────────────────────────────────────────────────────────────
// Retenção
// ─────────────────────────────────────────────────────────────────────────────

/** Dias de histórico mantidos em `webhook_events`. */
const WEBHOOK_EVENT_RETENTION_DAYS = 30

/**
 * Remove registros antigos. Sem isso `webhook_events` e `reconnect_tokens`
 * crescem indefinidamente — cada evento guarda o payload completo.
 */
async function purgeOldRecords(
  supabase: Awaited<ReturnType<typeof createServiceClient>>
): Promise<{ webhookEvents: number; reconnectTokens: number }> {
  const cutoff = new Date(Date.now() - WEBHOOK_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

  let webhookEvents = 0
  let reconnectTokens = 0

  const { data: events, error: eventsError } = await supabase
    .from('webhook_events')
    .delete()
    .lt('received_at', cutoff)
    .select('id')

  if (eventsError) console.error('[monitor] purge webhook_events falhou:', eventsError.message)
  else webhookEvents = events?.length ?? 0

  // Tokens expirados há mais de 7 dias não servem nem para auditoria.
  const tokenCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: tokens, error: tokensError } = await supabase
    .from('reconnect_tokens')
    .delete()
    .lt('expires_at', tokenCutoff)
    .select('id')

  if (tokensError) console.error('[monitor] purge reconnect_tokens falhou:', tokensError.message)
  else reconnectTokens = tokens?.length ?? 0

  return { webhookEvents, reconnectTokens }
}

// ─────────────────────────────────────────────────────────────────────────────
// Watchdog do webhook
// ─────────────────────────────────────────────────────────────────────────────

/** Minutos desde o último evento de webhook recebido, ou null se nunca houve. */
async function webhookSilenceMinutes(
  supabase: Awaited<ReturnType<typeof createServiceClient>>
): Promise<number | null> {
  const { data } = await supabase
    .from('webhook_events')
    .select('received_at')
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data?.received_at) return null

  const diffMs = Date.now() - new Date(data.received_at).getTime()
  return Math.floor(diffMs / 60_000)
}
