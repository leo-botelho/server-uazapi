import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getInstanceClient } from '@/lib/api-helpers'
import type { InstanceStatus } from '@/lib/uazapi/types'
import type { Json } from '@/types/database'
import { randomBytes } from 'crypto'

// Public endpoint — no auth, no middleware cookie handling.
// uazapiGO must be able to reach this without credentials.

// ─────────────────────────────────────────────────────────────────────────────
// Actual uazapiGO global webhook payload (confirmed via webhook.cool test):
//
// {
//   "BaseUrl":      "https://smartskillshub.uazapi.com",
//   "EventType":    "connection",          ← NOT "event"
//   "token":        "814e3744-...",        ← instance auth token, top-level
//   "owner":        "5521995474764",       ← phone number, top-level
//   "instanceName": "bruna_lopes",
//   "type":         "LoggedOut",           ← optional event subtype
//   "instance": {                          ← object, NOT a string token
//     "name":   "bruna_lopes",
//     "status": "disconnected" | "connected" | "connecting",
//     "qrcode": "data:image/png;base64,...",   ← when connecting
//     "lastDisconnect":       "2026-06-09 ...", ← when disconnected
//     "lastDisconnectReason": "401: ...",        ← when disconnected
//   }
// }
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>

  // ── Normalise event type ───────────────────────────────────────────────────
  // Global webhook uses "EventType"; per-instance webhook (legacy) uses "event".
  const eventType = String(
    raw['EventType'] ?? raw['event'] ?? ''
  ).toLowerCase()

  console.log(
    `[webhook] EventType="${eventType}" keys=${Object.keys(raw).join(',')} ` +
    `token="${String(raw['token'] ?? '').slice(0, 8)}..." ` +
    `instanceStatus="${(raw['instance'] as Record<string, unknown>)?.['status'] ?? '?'}"`
  )

  // Only care about connection events for status monitoring.
  if (eventType !== 'connection') {
    return NextResponse.json({ received: true })
  }

  // ── Extract instance auth token ────────────────────────────────────────────
  // Global format: top-level "token" field.
  // Legacy per-instance format: "instance" field as string or { token, id }.
  const rawInstance = raw['instance']
  const uazapiToken: string | undefined =
    typeof raw['token'] === 'string' && raw['token'].trim()
      ? (raw['token'] as string)
      : typeof rawInstance === 'string' && rawInstance.trim()
        ? rawInstance
        : typeof rawInstance === 'object' && rawInstance !== null
          ? (
              ((rawInstance as Record<string, unknown>)['token'] as string | undefined) ??
              ((rawInstance as Record<string, unknown>)['id']    as string | undefined)
            )
          : undefined

  if (!uazapiToken) {
    console.warn('[webhook] connection event missing token:', JSON.stringify(raw).slice(0, 300))
    return NextResponse.json({ received: true })
  }

  // ── Extract status, phone, reason ─────────────────────────────────────────
  // Global format: instance.status, owner (top-level), instance.lastDisconnectReason
  // Legacy format: data.status, data.phone, data.reason
  const instanceObj   = (typeof rawInstance === 'object' && rawInstance !== null ? rawInstance : {}) as Record<string, unknown>
  const rawData       = (raw['data'] ?? {}) as Record<string, unknown>

  const status = (instanceObj['status'] ?? rawData['status']) as InstanceStatus | undefined
  const phone  = typeof raw['owner'] === 'string' ? raw['owner']
               : typeof rawData['phone'] === 'string' ? rawData['phone']
               : undefined
  const reason = typeof instanceObj['lastDisconnectReason'] === 'string' ? instanceObj['lastDisconnectReason']
               : typeof raw['type'] === 'string' ? raw['type']
               : typeof rawData['reason'] === 'string' ? rawData['reason']
               : undefined

  void reason

  const supabase = await createServiceClient()

  // 1. Find instance by uazapi_token
  const { data: instance, error: findError } = await supabase
    .from('instances')
    .select('id, name, status, alert_channel, alert_config, silence_start, silence_end, client_id')
    .eq('uazapi_token', uazapiToken)
    .eq('active', true)
    .maybeSingle()

  if (findError) {
    console.error('[webhook] DB lookup error:', findError.message)
    return NextResponse.json({ received: true })
  }

  // 2. Log the raw event (always, even when instance not found)
  await supabase.from('webhook_events').insert({
    instance_id: instance?.id ?? null,
    event_type: 'connection',
    payload: body as Json,
  }).then(({ error }) => {
    if (error) console.error('[webhook] Failed to log event:', error.message)
  })

  if (!instance) {
    console.warn(
      `[webhook] No active instance for token="${uazapiToken.slice(0, 12)}...". ` +
      'Run "Sincronizar uazapiGO" to import the token.'
    )
    return NextResponse.json({ received: true })
  }

  console.log(`[webhook] Updating instance "${instance.name}" status: ${instance.status} → ${status}`)

  // 3. Update instance status in DB
  type UpdatePayload = {
    status: InstanceStatus | undefined
    phone_connected?: string | null
    last_disconnected_at?: string
  }

  const updatePayload: UpdatePayload = { status }

  if (status === 'connected') {
    // Store connected phone (owner) — clear last_disconnected_at implicitly via status
    if (phone) updatePayload.phone_connected = phone
  } else if (status === 'disconnected') {
    updatePayload.phone_connected = null
    updatePayload.last_disconnected_at = new Date().toISOString()
  }
  // status === 'connecting': no phone change needed

  await supabase
    .from('instances')
    .update(updatePayload)
    .eq('id', instance.id)
    .then(({ error }) => {
      if (error) console.error('[webhook] Failed to update instance status:', error.message)
      else console.log(`[webhook] Instance "${instance.name}" updated to "${status}"`)
    })

  // 4. Fire disconnect notification only when transitioning connected → disconnected
  if (status === 'disconnected' && instance.status !== 'disconnected') {
    console.log(`[webhook] Triggering disconnect notification for "${instance.name}"`)
    sendDisconnectNotification(supabase, instance).catch((err: unknown) => {
      console.error('[webhook] Notification error:', err instanceof Error ? err.message : String(err))
    })
  }

  return NextResponse.json({ received: true })
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification dispatcher — runs fire-and-forget after the 200 response
// ─────────────────────────────────────────────────────────────────────────────

type InstanceRow = {
  id: string
  name: string
  alert_channel: string
  alert_config: unknown
  silence_start: number | null
  silence_end: number | null
  client_id: string | null
}

async function sendDisconnectNotification(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  instance: InstanceRow
): Promise<void> {
  const channel = instance.alert_channel ?? 'none'
  if (channel === 'none' || channel === 'email') return

  // Check silence window (UTC hours)
  const currentHour = new Date().getUTCHours()
  const silenceStart = instance.silence_start ?? 23
  const silenceEnd   = instance.silence_end   ?? 7

  if (isInSilenceWindow(currentHour, silenceStart, silenceEnd)) {
    console.log(`[notify] Silence window active (${silenceStart}h–${silenceEnd}h UTC), skipping`)
    return
  }

  // Fetch client name for the message
  let clientName = 'Cliente'
  if (instance.client_id) {
    const { data: client } = await supabase
      .from('clients')
      .select('name')
      .eq('id', instance.client_id)
      .maybeSingle()
    if (client?.name) clientName = client.name
  }

  // Generate reconnect token valid for 24h
  const token     = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  await supabase.from('reconnect_tokens').insert({
    instance_id: instance.id,
    token,
    expires_at: expiresAt,
  })

  const appUrl       = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const reconnectUrl = `${appUrl}/connect/${token}`

  // Use custom template from alert_config.message_template, or default
  const config         = (instance.alert_config ?? {}) as Record<string, unknown>
  const customTemplate = typeof config['message_template'] === 'string' && config['message_template'].trim()
    ? config['message_template'].trim()
    : null

  const messageTemplate = customTemplate ??
    `⚠️ *Instância desconectada*\n\n` +
    `Olá {clientName},\n\n` +
    `A instância *{instanceName}* foi desconectada do WhatsApp.\n\n` +
    `Para reconectar, acesse o link abaixo:\n{reconnectUrl}\n\n` +
    `_Link válido por 24 horas._`

  const message = messageTemplate
    .replace(/\{clientName\}/g,   clientName)
    .replace(/\{instanceName\}/g, instance.name)
    .replace(/\{reconnectUrl\}/g, reconnectUrl)

  let notifStatus: 'sent' | 'failed' = 'failed'
  let notifError: string | null = null

  try {
    if (channel === 'whatsapp') {
      await sendWhatsAppNotification(instance, message)
      notifStatus = 'sent'
    } else if (channel === 'n8n') {
      await sendN8nNotification(instance, {
        event:         'disconnected',
        instanceId:    instance.id,
        instanceName:  instance.name,
        clientName,
        reconnectUrl,
      })
      notifStatus = 'sent'
    }
  } catch (err) {
    notifError = err instanceof Error ? err.message : String(err)
    console.error(`[notify] ${channel} send failed:`, notifError)
  }

  await supabase.from('notifications_log').insert({
    instance_id: instance.id,
    channel,
    status:  notifStatus,
    error:   notifError,
    sent_at: notifStatus === 'sent' ? new Date().toISOString() : null,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel helpers
// ─────────────────────────────────────────────────────────────────────────────

async function sendWhatsAppNotification(instance: InstanceRow, message: string): Promise<void> {
  const config         = (instance.alert_config ?? {}) as Record<string, unknown>
  const to             = typeof config['to'] === 'string' ? config['to'] : null
  const fromInstanceId = typeof config['from_instance_id'] === 'string' ? config['from_instance_id'] : null

  if (!to)             throw new Error('alert_config.to is not configured for WhatsApp channel')
  if (!fromInstanceId) throw new Error('alert_config.from_instance_id is not configured for WhatsApp channel')

  const clientResult = await getInstanceClient(fromInstanceId)
  if (!clientResult) throw new Error(`Sender instance ${fromInstanceId} not found`)

  const { client, uazapiToken } = clientResult
  await client.sendText(uazapiToken, to, message)
}

async function sendN8nNotification(
  instance: InstanceRow,
  payload: Record<string, unknown>
): Promise<void> {
  const config = (instance.alert_config ?? {}) as Record<string, unknown>
  const url    = typeof config['url'] === 'string' ? config['url'] : null

  if (!url) throw new Error('alert_config.url is not configured for n8n channel')

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`n8n responded ${res.status}: ${text}`)
  }
}

// Returns true if hour is inside the silence window (handles midnight wrap).
function isInSilenceWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return false
  if (start > end)   return hour >= start || hour < end   // e.g. 23h–7h
  return hour >= start && hour < end                       // e.g. 13h–15h
}
