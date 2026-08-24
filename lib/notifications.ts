import { createServiceClient } from '@/lib/supabase/server'
import { getInstanceClient } from '@/lib/api-helpers'
import { isOffline, type InstanceStatus } from '@/lib/uazapi/types'
import { normalizeSecret } from '@/lib/uazapi/client'

/**
 * Disparo de alertas de queda de instância.
 *
 * Compartilhado entre o receptor de webhook (`app/api/webhook/route.ts`) e o
 * monitor ativo (`app/api/monitor/tick/route.ts`) — os dois precisam alertar
 * exatamente do mesmo jeito, e antes essa lógica vivia só no webhook.
 *
 * Regras que este módulo garante:
 *  - Nada é descartado em silêncio: todo alerta suprimido vira linha em
 *    `notifications_log` com `reason` preenchido.
 *  - Alerta que cai na janela de silêncio fica `pending` com `scheduled_for`,
 *    e o monitor reenvia quando a janela termina (antes era perdido para sempre).
 *  - Cooldown por instância evita repetir alerta a cada tentativa frustrada de
 *    reconexão (o ciclo connecting → disconnected disparava um alerta por vez).
 */

export type SupabaseService = Awaited<ReturnType<typeof createServiceClient>>

export interface AlertInstance {
  id: string
  name: string
  alert_channel: string | null
  alert_config: unknown
  silence_start: number | null
  silence_end: number | null
  client_id: string | null
}

/** Janela mínima entre dois alertas da mesma instância. */
const ALERT_COOLDOWN_MINUTES = 30

/** Validade do link de reconexão enviado ao cliente. */
const RECONNECT_TOKEN_HOURS = 24

// ─────────────────────────────────────────────────────────────────────────────
// Janela de silêncio
// ─────────────────────────────────────────────────────────────────────────────

/** True se a hora (UTC) está dentro da janela de silêncio; trata a virada da meia-noite. */
export function isInSilenceWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return false
  if (start > end) return hour >= start || hour < end   // ex: 23h–7h
  return hour >= start && hour < end                     // ex: 13h–15h
}

/** Instante em que a janela de silêncio termina, a partir de `from`. */
export function silenceWindowEndsAt(from: Date, end: number): Date {
  const target = new Date(from)
  target.setUTCMinutes(0, 0, 0)
  target.setUTCHours(end)
  if (target <= from) target.setUTCDate(target.getUTCDate() + 1)
  return target
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrada principal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decide se a transição de status merece alerta e dispara.
 *
 * Só alerta quando a instância SAI de um estado saudável para um estado offline
 * (`disconnected` ou `hibernated`). A guarda antiga era `!== 'disconnected'`,
 * o que fazia `connecting → disconnected` (QR expirado sem escanear) disparar
 * um alerta novo a cada tentativa.
 */
export async function handleStatusTransition(
  supabase: SupabaseService,
  instance: AlertInstance,
  previousStatus: InstanceStatus | null,
  newStatus: InstanceStatus,
  reason?: string
): Promise<void> {
  const wasOffline = isOffline(previousStatus)
  const nowOffline = isOffline(newStatus)

  // Alerta apenas na borda saudável → offline.
  if (!nowOffline || wasOffline) return

  // `connecting → disconnected` é uma tentativa de reconexão que falhou, não uma
  // queda nova. O cliente já está com o portal aberto; alertar de novo é spam.
  if (previousStatus === 'connecting') {
    console.log(`[notify] "${instance.name}": connecting → ${newStatus} (tentativa falhou), sem alerta`)
    return
  }

  await sendOfflineAlert(supabase, instance, newStatus, reason)
}

/**
 * Envia (ou agenda) o alerta de queda. Respeita cooldown e janela de silêncio.
 * Sempre deixa rastro em `notifications_log`.
 */
export async function sendOfflineAlert(
  supabase: SupabaseService,
  instance: AlertInstance,
  status: InstanceStatus,
  reason?: string
): Promise<void> {
  const channel = instance.alert_channel ?? 'none'

  // ── Canal não configurado: registra para o operador enxergar ──────────────
  if (channel === 'none' || channel === 'email') {
    await logNotification(supabase, {
      instanceId: instance.id,
      channel,
      status: 'failed',
      reason: channel === 'email' ? 'channel_email_unsupported' : 'channel_none',
      error: channel === 'email'
        ? 'Canal "email" não é implementado — use o canal n8n e dispare o e-mail pelo fluxo.'
        : 'Nenhum canal de alerta configurado para esta instância.',
    })
    return
  }

  // ── Cooldown: evita repetir alerta da mesma instância ─────────────────────
  if (await hasRecentAlert(supabase, instance.id)) {
    console.log(`[notify] "${instance.name}": alerta recente dentro do cooldown, pulando`)
    return
  }

  // ── Janela de silêncio: ADIA em vez de descartar ──────────────────────────
  const now          = new Date()
  const silenceStart = instance.silence_start ?? 23
  const silenceEnd   = instance.silence_end   ?? 7

  if (isInSilenceWindow(now.getUTCHours(), silenceStart, silenceEnd)) {
    const scheduledFor = silenceWindowEndsAt(now, silenceEnd)
    console.log(
      `[notify] "${instance.name}": janela de silêncio ativa, ` +
      `alerta agendado para ${scheduledFor.toISOString()}`
    )
    await logNotification(supabase, {
      instanceId:   instance.id,
      channel,
      status:       'pending',
      reason:       'silence_window',
      scheduledFor: scheduledFor.toISOString(),
    })
    return
  }

  await deliverAlert(supabase, instance, status, reason)
}

/**
 * Reenvia os alertas que ficaram pendentes na janela de silêncio e cuja hora
 * já chegou. Chamado pelo monitor a cada ciclo.
 *
 * Só reenvia se a instância CONTINUA offline — se ela voltou sozinha durante a
 * madrugada, o pendente é descartado com o motivo registrado.
 */
export async function flushPendingAlerts(supabase: SupabaseService): Promise<number> {
  const { data: pending, error } = await supabase
    .from('notifications_log')
    .select('id, instance_id, channel')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .limit(50)

  if (error) {
    console.error('[notify] falha ao buscar alertas pendentes:', error.message)
    return 0
  }
  if (!pending?.length) return 0

  let delivered = 0

  for (const row of pending) {
    if (!row.instance_id) continue

    const { data: instance } = await supabase
      .from('instances')
      .select('id, name, status, alert_channel, alert_config, silence_start, silence_end, client_id')
      .eq('id', row.instance_id)
      .eq('active', true)
      .maybeSingle()

    // Instância sumiu ou voltou a funcionar → pendente deixa de fazer sentido.
    if (!instance || !isOffline(instance.status)) {
      await supabase
        .from('notifications_log')
        .update({
          status: 'failed',
          reason: instance ? 'recovered_before_send' : 'instance_gone',
          error:  instance
            ? `Instância voltou para "${instance.status}" antes do envio.`
            : 'Instância não encontrada ou inativa.',
        })
        .eq('id', row.id)
      continue
    }

    // Consome a linha pendente e envia uma nova (que registra o resultado real).
    await supabase
      .from('notifications_log')
      .update({ status: 'failed', reason: 'superseded_by_retry', error: 'Reenviado após a janela de silêncio.' })
      .eq('id', row.id)

    await deliverAlert(supabase, instance, instance.status, 'Alerta adiado pela janela de silêncio')
    delivered++
  }

  return delivered
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrega
// ─────────────────────────────────────────────────────────────────────────────

async function deliverAlert(
  supabase: SupabaseService,
  instance: AlertInstance,
  status: InstanceStatus,
  reason?: string
): Promise<void> {
  const channel = instance.alert_channel ?? 'none'

  // Nome do cliente para a mensagem
  let clientName = 'Cliente'
  if (instance.client_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('name')
      .eq('id', instance.client_id)
      .maybeSingle()
    if (client?.name) clientName = client.name
  }

  const reconnectUrl = await buildReconnectUrl(supabase, instance.id)

  const config = (instance.alert_config ?? {}) as Record<string, unknown>
  const customTemplate = typeof config['message_template'] === 'string' && config['message_template'].trim()
    ? config['message_template'].trim()
    : null

  // `hibernated` reconecta sem QR — a mensagem precisa refletir isso.
  const statusLabel = status === 'hibernated'
    ? 'hibernou (sessão pausada)'
    : 'foi desconectada do WhatsApp'

  const messageTemplate = customTemplate ??
    `⚠️ *Instância indisponível*\n\n` +
    `Olá {clientName},\n\n` +
    `A instância *{instanceName}* {statusLabel}.\n\n` +
    `Para reconectar, acesse o link abaixo:\n{reconnectUrl}\n\n` +
    `_Link válido por ${RECONNECT_TOKEN_HOURS} horas._`

  const message = messageTemplate
    .replace(/\{clientName\}/g,   clientName)
    .replace(/\{instanceName\}/g, instance.name)
    .replace(/\{statusLabel\}/g,  statusLabel)
    .replace(/\{reconnectUrl\}/g, reconnectUrl ?? '(link indisponível)')

  let notifStatus: 'sent' | 'failed' = 'failed'
  let notifError: string | null = null
  let recipient: string | null = null

  try {
    if (!reconnectUrl) {
      throw new Error('NEXT_PUBLIC_APP_URL não configurada — link de reconexão sairia quebrado.')
    }

    if (channel === 'whatsapp') {
      recipient = await sendWhatsAppNotification(instance, message)
    } else if (channel === 'n8n') {
      recipient = await sendN8nNotification(instance, {
        event:        status === 'hibernated' ? 'hibernated' : 'disconnected',
        status,
        instanceId:   instance.id,
        instanceName: instance.name,
        clientName,
        reconnectUrl,
        reason:       reason ?? null,
        message,
      })
    } else {
      throw new Error(`Canal de alerta desconhecido: ${channel}`)
    }
    notifStatus = 'sent'
  } catch (err) {
    notifError = err instanceof Error ? err.message : String(err)
    console.error(`[notify] envio via ${channel} falhou:`, notifError)
  }

  await logNotification(supabase, {
    instanceId: instance.id,
    channel,
    status:     notifStatus,
    recipient,
    error:      notifError,
    reason:     notifStatus === 'sent' ? null : 'delivery_error',
    sentAt:     notifStatus === 'sent' ? new Date().toISOString() : null,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Canais
// ─────────────────────────────────────────────────────────────────────────────

/** Envia pelo WhatsApp usando outra instância como remetente. Retorna o destinatário. */
async function sendWhatsAppNotification(instance: AlertInstance, message: string): Promise<string> {
  const config         = (instance.alert_config ?? {}) as Record<string, unknown>
  const to             = typeof config['to'] === 'string' ? config['to'] : null
  const fromInstanceId = typeof config['from_instance_id'] === 'string' ? config['from_instance_id'] : null

  if (!to)             throw new Error('alert_config.to não configurado para o canal WhatsApp')
  if (!fromInstanceId) throw new Error('alert_config.from_instance_id não configurado para o canal WhatsApp')

  // O remetente precisa estar conectado. O modo de falha típico do uazapiGO é
  // derrubar várias instâncias juntas — se a remetente também caiu, o alerta
  // morreria em silêncio. Melhor falhar explicitamente e registrar.
  const supabase = await createServiceClient()
  const { data: sender } = await supabase
    .from('instances')
    .select('name, status')
    .eq('id', fromInstanceId)
    .maybeSingle()

  if (!sender) throw new Error(`Instância remetente ${fromInstanceId} não encontrada`)
  if (sender.status !== 'connected') {
    throw new Error(`Instância remetente "${sender.name}" está "${sender.status}" — não é possível enviar o alerta.`)
  }

  const clientResult = await getInstanceClient(fromInstanceId)
  if (!clientResult) throw new Error(`Instância remetente ${fromInstanceId} não resolvida`)

  const { client, uazapiToken } = clientResult
  await client.sendText(uazapiToken, to, message)
  return to
}

/** Dispara o webhook n8n. Retorna a URL usada como destinatário. */
async function sendN8nNotification(
  instance: AlertInstance,
  payload: Record<string, unknown>
): Promise<string> {
  const config = (instance.alert_config ?? {}) as Record<string, unknown>
  const url    = typeof config['url'] === 'string' ? config['url'] : null

  if (!url) throw new Error('alert_config.url não configurado para o canal n8n')

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`n8n respondeu ${res.status}: ${text.slice(0, 200)}`)
  }

  return url
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

/** True se já houve alerta enviado/agendado para a instância dentro do cooldown. */
async function hasRecentAlert(supabase: SupabaseService, instanceId: string): Promise<boolean> {
  const since = new Date(Date.now() - ALERT_COOLDOWN_MINUTES * 60_000).toISOString()

  const { data } = await supabase
    .from('notifications_log')
    .select('id')
    .eq('instance_id', instanceId)
    .in('status', ['sent', 'pending'])
    .gte('created_at', since)
    .limit(1)

  return !!data?.length
}

/**
 * Reaproveita um token de reconexão válido ou cria um novo.
 * Reaproveitar evita encher a tabela a cada alerta e mantém um único link
 * funcional na mão do cliente.
 */
async function buildReconnectUrl(supabase: SupabaseService, instanceId: string): Promise<string | null> {
  const appUrl = normalizeSecret(process.env.NEXT_PUBLIC_APP_URL).replace(/\/$/, '')
  if (!appUrl) {
    console.error('[notify] NEXT_PUBLIC_APP_URL ausente — não é possível montar o link de reconexão')
    return null
  }

  const { data: existing } = await supabase
    .from('reconnect_tokens')
    .select('token')
    .eq('instance_id', instanceId)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing?.token) return `${appUrl}/connect/${existing.token}`

  const token     = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const expiresAt = new Date(Date.now() + RECONNECT_TOKEN_HOURS * 60 * 60 * 1000).toISOString()

  const { error } = await supabase
    .from('reconnect_tokens')
    .insert({ instance_id: instanceId, token, expires_at: expiresAt })

  if (error) {
    // Antes esse erro era ignorado e a mensagem saía com um link que dava 404.
    console.error('[notify] falha ao criar token de reconexão:', error.message)
    return null
  }

  return `${appUrl}/connect/${token}`
}

/** Insere uma linha em `notifications_log`. Nunca lança. */
async function logNotification(
  supabase: SupabaseService,
  entry: {
    instanceId: string
    channel: string
    status: 'sent' | 'failed' | 'pending'
    recipient?: string | null
    error?: string | null
    reason?: string | null
    sentAt?: string | null
    scheduledFor?: string | null
  }
): Promise<void> {
  const { error } = await supabase.from('notifications_log').insert({
    instance_id:   entry.instanceId,
    channel:       entry.channel,
    status:        entry.status,
    recipient:     entry.recipient    ?? null,
    error:         entry.error        ?? null,
    reason:        entry.reason       ?? null,
    sent_at:       entry.sentAt       ?? null,
    scheduled_for: entry.scheduledFor ?? null,
  })

  if (error) console.error('[notify] falha ao registrar notificação:', error.message)
}
