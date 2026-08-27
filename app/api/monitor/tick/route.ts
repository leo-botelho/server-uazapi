import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createUazapi, uazapi, normalizeSecret } from '@/lib/uazapi/client'
import type { UazapiClient } from '@/lib/uazapi/client'
import { isInstanceStatus, isOffline, type InstanceStatus, type GlobalWebhookConfig } from '@/lib/uazapi/types'
import { handleStatusTransition, flushPendingAlerts, type AlertInstance } from '@/lib/notifications'
import { withMissingColumnFallback } from '@/lib/db-resilient'

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

/**
 * Remove TODO espaco em branco de um secret, nao so das pontas.
 *
 * Um valor hex copiado de um terminal que quebrou a linha chega com um
 * newline no MEIO. O agendador ja normalizava assim (`tr -d [:space:]`), e o
 * app so fazia trim() — as duas pontas nunca batiam e o resultado era um 401
 * sem explicacao. Secrets validos nao contem espaco, entao remover e seguro.
 */
function cleanSecret(value: string | undefined | null): string {
  return (value ?? '').replace(/\s+/g, '')
}

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
  const expected = cleanSecret(process.env.MONITOR_SECRET)

  if (!expected) {
    console.error('[monitor] MONITOR_SECRET não configurado — endpoint desabilitado')
    return NextResponse.json(
      { error: 'Monitor não configurado. Defina o secret MONITOR_SECRET no Worker.' },
      { status: 503 }
    )
  }

  const provided = cleanSecret(
    request.headers.get('x-monitor-secret') ??
    request.nextUrl.searchParams.get('secret')
  )

  if (provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
  let checked  = 0
  let changed  = 0
  let alerted  = 0
  let repaired = 0
  let renamed  = 0
  const orphans: string[] = []
  const driftErrors: string[] = []
  const errors: string[] = []

  for (const target of targets) {
    try {
      const result = await reconcileServer(supabase, target)
      checked  += result.checked
      changed  += result.changed
      alerted  += result.alerted
      repaired += result.repaired
      renamed  += result.renamed
      orphans.push(...result.orphans)
      driftErrors.push(...result.driftErrors)
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
  // `deliveryAgo` = qualquer entrega (batimento); `connectionAgo` = so eventos
  // de conexao. Separar os dois distingue "webhook morto" de "webhook vivo, sem
  // mudanca de estado" — antes os dois eram o mesmo numero e enganavam.
  const [deliveryAgo, connectionAgo] = await Promise.all([
    lastDeliveryMinutes(supabase),
    webhookSilenceMinutes(supabase),
  ])

  const webhookHealthy = deliveryAgo !== null && deliveryAgo < WEBHOOK_SILENCE_ALERT_MINUTES
  const webhookSilentFor = deliveryAgo

  // Eventos que chegaram e nao encontraram instancia dona (busca por token).
  // Sinal claro de token divergente: a entrega funciona, mas o status nunca
  // muda porque o evento nao se liga a nenhum registro.
  const orphanEvents = await orphanEventCount(supabase)
  if (orphanEvents > 0) {
    console.warn(
      `[monitor] ${orphanEvents} evento(s) de webhook na ultima hora sem instancia ` +
      'correspondente — token divergente ou instancia ainda nao importada.'
    )
  }

  // Quando esta mudo, pergunta ao proprio uazapiGO por que as entregas falham.
  let deliveryErrors: Array<{ status?: number; error?: string; created?: string }> | undefined
  if (!webhookHealthy && targets[0]) {
    try {
      const errs = await targets[0].client.getGlobalWebhookErrors()
      deliveryErrors = errs.slice(0, 5).map((e) => ({
        status:  e.status_code,
        error:   e.error?.slice(0, 200),
        created: e.created,
      }))
      if (deliveryErrors.length) {
        console.warn('[monitor] erros de entrega do webhook global:', JSON.stringify(deliveryErrors))
      }
    } catch (err) {
      console.warn('[monitor] nao foi possivel ler /globalwebhook/errors:',
        err instanceof Error ? err.message : String(err))
    }
  }

  if (!webhookHealthy) {
    console.warn(
      `[monitor] ⚠️ Nenhuma entrega de webhook ha ${deliveryAgo ?? 'sempre'} min ` +
      `(ultimo evento de conexao ha ${connectionAgo ?? 'sempre'} min).`
    )
  }

  // ── 5. Auto-correcao do webhook global ────────────────────────────────────
  const webhookFix = await ensureGlobalWebhook(targets, webhookSilentFor)

  // ── 6. Retenção: as tabelas de log cresciam para sempre ───────────────────
  const purged = await purgeOldRecords(supabase)

  const summary = {
    ok: errors.length === 0,
    servers: targets.length,
    checked,
    changed,
    alerted,
    // Tokens corrigidos: o registro apontava para um token que nao existe mais,
    // o que tornava a instancia invisivel para o webhook e para o monitor.
    repaired,
    // Nomes atualizados a partir do uazapiGO.
    renamed,
    ...(driftErrors.length ? { driftErrors } : {}),
    // Existem no uazapiGO e nao no painel — precisam de "Sincronizar".
    ...(orphans.length ? { orphans } : {}),
    pendingAlertsSent: flushed,
    purged,
    webhook: {
      healthy: webhookHealthy,
      lastDeliveryMinutesAgo: deliveryAgo,
      lastConnectionEventMinutesAgo: connectionAgo,
      autofix: webhookFix,
      orphanEvents,
      ...(deliveryErrors?.length ? { deliveryErrors } : {}),
    },
    durationMs: Date.now() - startedAt,
    ...(errors.length ? { errors } : {}),
  }

  console.log('[monitor] tick:', JSON.stringify(summary))

  return NextResponse.json(summary, { status: errors.length ? 207 : 200 })
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
): Promise<{ checked: number; changed: number; alerted: number; repaired: number; renamed: number; orphans: string[]; driftErrors: string[] }> {
  const remote = await target.client.listInstances()

  if (!Array.isArray(remote) || remote.length === 0) {
    return { checked: 0, changed: 0, alerted: 0, repaired: 0, renamed: 0, orphans: [], driftErrors: [] }
  }

  // Token canonico da instancia remota — mesma regra usada pelo sync.
  const authToken = (inst: (typeof remote)[number]): string => inst.token ?? inst.id ?? ''

  // Le TODAS as instancias ativas, nao apenas as cujo token bate. Filtrar por
  // token aqui era o bug: quando o token guardado no banco diverge do atual, a
  // instancia sumia do monitor E do webhook (que tambem busca por token), e so
  // o botao "Sincronizar" — que repara o token — fazia o painel voltar a ver.
  const { data: rows, error } = await supabase
    .from('instances')
    .select('id, name, uazapi_token, status, alert_channel, alert_config, silence_start, silence_end, client_id')
    .eq('active', true)

  if (error) throw new Error(`consulta ao banco falhou: ${error.message}`)

  const byToken = new Map((rows ?? []).map((r) => [r.uazapi_token, r]))

  // Nome so serve como chave de reparo quando e inequivoco dos dois lados.
  const dbNameCount     = new Map<string, number>()
  const remoteNameCount = new Map<string, number>()
  for (const r of rows ?? [])  dbNameCount.set(r.name, (dbNameCount.get(r.name) ?? 0) + 1)
  for (const i of remote)      remoteNameCount.set(i.name, (remoteNameCount.get(i.name) ?? 0) + 1)
  const byName = new Map(
    (rows ?? [])
      .filter((r) => dbNameCount.get(r.name) === 1 && remoteNameCount.get(r.name) === 1)
      .map((r) => [r.name, r])
  )

  let checked  = 0
  let changed  = 0
  let alerted  = 0
  let repaired = 0
  let renamed  = 0
  const orphans: string[] = []
  const driftErrors: string[] = []
  const now = new Date().toISOString()

  for (const inst of remote) {
    const token = authToken(inst)
    if (!token) continue

    let row = byToken.get(token)

    // Token divergente: recupera pelo nome e corrige o registro.
    if (!row) {
      const candidate = byName.get(inst.name)
      if (candidate && !byToken.has(candidate.uazapi_token === token ? '' : token)) {
        const { error: repairError } = await withMissingColumnFallback(
          { uazapi_token: token, last_seen_at: now },
          (p) => supabase.from('instances').update(p).eq('id', candidate.id),
          `reparo de token de "${inst.name}"`
        )

        if (repairError) {
          console.error(`[monitor] falha ao reparar token de "${inst.name}":`, repairError.message)
        } else {
          console.warn(
            `[monitor] token corrigido para "${inst.name}" — o registro apontava para um token ` +
            'que nao existe mais no servidor, entao webhook e monitor nao a enxergavam.'
          )
          repaired++
          row = { ...candidate, uazapi_token: token }
          byToken.set(token, row)
        }
      }
    }

    if (!row) {
      // Existe no uazapiGO e nao no painel: precisa de importacao via Sincronizar.
      orphans.push(inst.name)
      continue
    }

    checked++

    if (!isInstanceStatus(inst.status)) {
      console.warn(`[monitor] status desconhecido "${String(inst.status)}" em "${row.name}", ignorando`)
      continue
    }

    const previousStatus = row.status as InstanceStatus
    const newStatus      = inst.status

    // Campos que mudam independentemente do status — nome incluso. Antes, sem
    // mudanca de status o monitor so carimbava `last_seen_at`, entao renomear a
    // instancia no painel do uazapiGO nunca chegava aqui.
    const remoteName    = inst.name?.trim()
    const remoteProfile = inst.profileName   ?? inst.profileInfo?.name    ?? null
    const remotePicture = inst.profilePicUrl ?? inst.profileInfo?.picture ?? null

    const drift: {
      last_seen_at: string
      name?: string
      profile_name?: string | null
      profile_picture?: string | null
    } = { last_seen_at: now }

    if (remoteName && remoteName !== row.name) {
      drift.name = remoteName
      console.log(`[monitor] "${row.name}" renomeada no uazapiGO para "${remoteName}"`)
      renamed++
    }
    if (remoteProfile !== null) drift.profile_name    = remoteProfile
    if (remotePicture !== null) drift.profile_picture = remotePicture

    if (newStatus === previousStatus) {
      const { error: driftError } = await withMissingColumnFallback(
        drift,
        (p) => supabase.from('instances').update(p).eq('id', row.id),
        `drift de "${row.name}"`
      )

      // Este erro era engolido: o nome nunca era gravado e todo tick voltava a
      // reportar a mesma instancia como renomeada.
      if (driftError) {
        console.error(
          `[monitor] falha ao atualizar "${row.name}" -> "${drift.name ?? row.name}": ${driftError.message}`
        )
        driftErrors.push(`${row.name}: ${driftError.message}`)
      }
      continue
    }

    const updatePayload: typeof drift & {
      status: InstanceStatus
      phone_connected?: string | null
      last_disconnected_at?: string
    } = { ...drift, status: newStatus }

    if (newStatus === 'connected') {
      updatePayload.phone_connected = inst.owner ?? inst.phone ?? null
    } else if (newStatus === 'disconnected') {
      updatePayload.phone_connected      = null
      updatePayload.last_disconnected_at = inst.lastDisconnect ?? inst.lastDisconnection ?? now
    } else if (newStatus === 'hibernated') {
      updatePayload.last_disconnected_at = inst.lastDisconnect ?? inst.lastDisconnection ?? now
    }

    // Compare-and-set: se o webhook aplicou a mesma mudanca enquanto isso, ele
    // ja cuidou do alerta e este ciclo nao deve notificar de novo.
    const { data: updated, error: updateError } = await withMissingColumnFallback<{ id: string }[], typeof updatePayload>(
      updatePayload,
      (p) => supabase
        .from('instances')
        .update(p)
        .eq('id', row.id)
        .eq('status', previousStatus)
        .select('id'),
      `status de "${row.name}"`
    )

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

  return { checked, changed, alerted, repaired, renamed, orphans, driftErrors }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-correcao do webhook global
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Garante que o webhook global do uazapiGO aponta para o receptor deste painel
 * e esta ativo.
 *
 * Motivo: o webhook global e o unico canal em tempo real do painel, e ele ja
 * ficou 38 horas mudo sem ninguem perceber — ora `enabled: false` (o servidor
 * desativa sozinho apos falhas de entrega), ora apontando para outra URL. O
 * resultado pratico foi uma instancia reconectar e o painel so refletir isso
 * quando alguem clicou em "Sincronizar".
 *
 * ⚠️ Mexe SOMENTE no webhook GLOBAL (admintoken). Os webhooks por instancia
 * pertencem aos agentes de IA no n8n e nunca sao tocados.
 *
 * Desligue com MONITOR_AUTOFIX_WEBHOOK=false caso o webhook global passe a ser
 * usado por outro consumidor.
 */
async function ensureGlobalWebhook(
  targets: ServerTarget[],
  webhookSilentFor: number | null
): Promise<{ checked: boolean; action: string; detail?: string }> {
  if (process.env.MONITOR_AUTOFIX_WEBHOOK === 'false') {
    return { checked: false, action: 'disabled_by_config' }
  }

  const appUrl = normalizeSecret(process.env.NEXT_PUBLIC_APP_URL)
  if (!appUrl) {
    return { checked: false, action: 'skipped', detail: 'NEXT_PUBLIC_APP_URL ausente' }
  }

  const receiver = `${appUrl.replace(/\/$/, '')}/api/webhook`
  const target   = targets[0]
  if (!target) return { checked: false, action: 'skipped', detail: 'nenhum servidor' }

  try {
    const configs = await target.client.getGlobalWebhook()
    const current = configs[0] ?? null

    const pointsHere  = normalizeSecret(current?.url ?? '') === normalizeSecret(receiver)
    const isEnabled   = current?.enabled === true
    const hasConnection = (current?.events ?? []).includes('connection')

    // Ja esta correto: nao mexe.
    if (current && pointsHere && isEnabled && hasConnection) {
      return { checked: true, action: 'ok' }
    }

    // Aponta para outro destino E esta funcionando: nao sequestra a configuracao
    // de outra pessoa so porque este painel nao esta recebendo. So intervem
    // quando o webhook esta claramente inutil (ausente, desativado, ou sem o
    // evento connection) ou quando ja faz muito tempo que nada chega aqui.
    const silentTooLong = webhookSilentFor === null || webhookSilentFor >= WEBHOOK_SILENCE_ALERT_MINUTES
    if (current && !pointsHere && isEnabled && hasConnection && !silentTooLong) {
      return {
        checked: true,
        action: 'left_alone',
        detail: `webhook global aponta para ${current.url} e esta ativo`,
      }
    }

    // Preserva os eventos ja configurados e garante `connection`.
    const events = Array.from(new Set([...(current?.events ?? []), 'connection'])) as GlobalWebhookConfig['events']

    const desired: GlobalWebhookConfig = {
      url: receiver,
      enabled: true,
      events,
      ...(current?.excludeMessages ? { excludeMessages: current.excludeMessages } : {}),
    }

    console.warn(
      `[monitor] corrigindo webhook global — antes: url=${current?.url ?? '(nenhum)'} ` +
      `enabled=${String(current?.enabled)} events=${(current?.events ?? []).join(',') || '(nenhum)'}`
    )

    await target.client.setGlobalWebhook(desired)

    // Confirma o que o servidor de fato gravou.
    const after = (await target.client.getGlobalWebhook())[0] ?? null

    if (after?.enabled === true && normalizeSecret(after.url ?? '') === normalizeSecret(receiver)) {
      console.log('[monitor] webhook global corrigido e ativo')
      return { checked: true, action: 'fixed' }
    }

    return {
      checked: true,
      action: 'fix_failed',
      detail: `apos salvar: url=${after?.url ?? '(nenhum)'} enabled=${String(after?.enabled)}`,
    }
  } catch (err) {
    return {
      checked: true,
      action: 'error',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
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

/** Eventos recebidos na ultima hora que nao foram associados a nenhuma instancia. */
async function orphanEventCount(
  supabase: Awaited<ReturnType<typeof createServiceClient>>
): Promise<number> {
  const since = new Date(Date.now() - 60 * 60_000).toISOString()
  const { count, error } = await supabase
    .from('webhook_events')
    .select('id', { count: 'exact', head: true })
    .is('instance_id', null)
    .gte('received_at', since)

  if (error) {
    console.warn('[monitor] contagem de eventos orfaos falhou:', error.message)
    return 0
  }
  return count ?? 0
}

/**
 * Minutos desde a ultima ENTREGA de webhook de qualquer tipo (tabela de
 * batimento). null = nenhuma entrega registrada desde que a tabela existe.
 */
async function lastDeliveryMinutes(
  supabase: Awaited<ReturnType<typeof createServiceClient>>
): Promise<number | null> {
  const { data, error } = await supabase
    .from('webhook_heartbeat')
    .select('last_event_at')
    .eq('id', true)
    .maybeSingle()

  // Migration 010 ainda nao aplicada: cai para o sinal antigo em vez de quebrar.
  if (error) {
    console.warn('[monitor] webhook_heartbeat indisponivel:', error.message)
    return webhookSilenceMinutes(supabase)
  }

  if (!data?.last_event_at) return null
  return Math.floor((Date.now() - new Date(data.last_event_at).getTime()) / 60_000)
}

/** Minutos desde o último evento de CONEXÃO recebido, ou null se nunca houve. */
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
