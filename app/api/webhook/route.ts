import { NextRequest, NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { isInstanceStatus, type InstanceStatus } from '@/lib/uazapi/types'
import { handleStatusTransition, type AlertInstance } from '@/lib/notifications'
import type { Json } from '@/types/database'

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
//     "status": "disconnected" | "connected" | "connecting" | "hibernated",
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

  const rawStatus = instanceObj['status'] ?? rawData['status']
  const phone  = typeof raw['owner'] === 'string' ? raw['owner']
               : typeof rawData['phone'] === 'string' ? rawData['phone']
               : undefined
  const reason = typeof instanceObj['lastDisconnectReason'] === 'string' ? instanceObj['lastDisconnectReason']
               : typeof raw['type'] === 'string' ? raw['type']
               : typeof rawData['reason'] === 'string' ? rawData['reason']
               : undefined

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
    // 500 faz o uazapiGO tentar de novo — antes respondia 200 e o evento se perdia.
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 })
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

  // ── Valida o status ANTES de gravar ───────────────────────────────────────
  // Sem isso, um payload em formato novo gravava `undefined` e o PATCH virava
  // um no-op silencioso — as quedas simplesmente paravam de ser registradas.
  if (!isInstanceStatus(rawStatus)) {
    console.error(
      `[webhook] status inválido "${String(rawStatus)}" para "${instance.name}" — ` +
      'o formato do payload do uazapiGO pode ter mudado. Evento registrado, status não alterado.'
    )
    return NextResponse.json({ received: true, warning: 'unknown status' })
  }

  const status         = rawStatus
  const previousStatus = instance.status as InstanceStatus

  console.log(`[webhook] Updating instance "${instance.name}" status: ${previousStatus} → ${status}`)

  // 3. Update instance status in DB
  const updatePayload: {
    status: InstanceStatus
    last_seen_at: string
    phone_connected?: string | null
    last_disconnected_at?: string
  } = {
    status,
    last_seen_at: new Date().toISOString(),
  }

  if (status === 'connected') {
    if (phone) updatePayload.phone_connected = phone
  } else if (status === 'disconnected') {
    updatePayload.phone_connected = null
    updatePayload.last_disconnected_at = new Date().toISOString()
  } else if (status === 'hibernated') {
    // Hibernação preserva as credenciais: o número continua pareado, então o
    // telefone NÃO é limpo — só marcamos o momento da parada.
    updatePayload.last_disconnected_at = new Date().toISOString()
  }
  // status === 'connecting': no phone change needed

  // Compare-and-set: só grava se o status no banco ainda for o que lemos.
  // Dois webhooks concorrentes (retry do uazapiGO) chegavam a notificar duas vezes.
  const { data: updated, error: updateError } = await supabase
    .from('instances')
    .update(updatePayload)
    .eq('id', instance.id)
    .eq('status', previousStatus)
    .select('id')

  if (updateError) {
    console.error('[webhook] Failed to update instance status:', updateError.message)
    return NextResponse.json({ error: 'update failed' }, { status: 500 })
  }

  const won = (updated?.length ?? 0) > 0

  if (!won) {
    // Outra invocação já aplicou uma mudança — ela cuida da notificação.
    console.log(`[webhook] "${instance.name}": status mudou concorrentemente, ignorando este evento`)
    return NextResponse.json({ received: true, raced: true })
  }

  console.log(`[webhook] Instance "${instance.name}" updated to "${status}"`)

  // 4. Notifica em background — `after()` mantém o worker vivo até terminar.
  //    Sem isso, no Cloudflare Workers a promessa podia ser cancelada no meio:
  //    token criado, mensagem nunca enviada e sem registro nenhum.
  if (status !== previousStatus) {
    after(async () => {
      try {
        await handleStatusTransition(
          supabase,
          instance as AlertInstance,
          previousStatus,
          status,
          reason
        )
      } catch (err) {
        console.error('[webhook] Notification error:', err instanceof Error ? err.message : String(err))
      }
    })
  }

  return NextResponse.json({ received: true })
}
