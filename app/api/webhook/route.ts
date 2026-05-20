import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import type { WebhookConnectionEvent } from '@/lib/uazapi/types'
import type { Json } from '@/types/database'

// Public endpoint — no auth, no middleware cookie handling.
// uazapiGO must be able to reach this without credentials.

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Basic shape validation before touching the DB
  if (
    typeof body !== 'object' ||
    body === null ||
    !('event' in body) ||
    !('instance' in body) ||
    !('data' in body)
  ) {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 })
  }

  const event = body as WebhookConnectionEvent

  if (event.event !== 'connection') {
    // We only handle connection events right now — acknowledge and move on
    return NextResponse.json({ received: true })
  }

  const uazapiToken = event.instance
  const { status, phone, reason } = event.data

  const supabase = await createServiceClient()

  // 1. Find instance by uazapi_token
  const { data: instance, error: findError } = await supabase
    .from('instances')
    .select('id, alert_channel, alert_config, status')
    .eq('uazapi_token', uazapiToken)
    .eq('active', true)
    .maybeSingle()

  if (findError) {
    console.error('[webhook] DB lookup error:', findError.message)
    // Still return 200 so uazapiGO does not keep retrying forever
    return NextResponse.json({ received: true })
  }

  // 2. Log the raw event regardless of whether we found the instance
  const { error: logError } = await supabase.from('webhook_events').insert({
    instance_id: instance?.id ?? null,
    event_type: event.event,
    payload: body as Json,
  })

  if (logError) {
    console.error('[webhook] Failed to log event:', logError.message)
  }

  if (!instance) {
    // Unknown instance — still return 200
    return NextResponse.json({ received: true })
  }

  // 3. Build status update
  const updatePayload: {
    status: typeof status
    phone_connected?: string | null
    last_disconnected_at?: string
  } = { status }

  if (phone) {
    updatePayload.phone_connected = phone
  } else if (status === 'disconnected') {
    updatePayload.phone_connected = null
    updatePayload.last_disconnected_at = new Date().toISOString()
  }

  const { error: updateError } = await supabase
    .from('instances')
    .update(updatePayload)
    .eq('id', instance.id)

  if (updateError) {
    console.error('[webhook] Failed to update instance status:', updateError.message)
  }

  // 4. Trigger notification if instance just disconnected
  if (status === 'disconnected' && instance.status !== 'disconnected') {
    await triggerDisconnectNotification(supabase, instance.id, {
      alertChannel: instance.alert_channel,
      alertConfig: instance.alert_config,
      reason: reason ?? null,
    }).catch((err: unknown) => {
      console.error('[webhook] Notification error:', err instanceof Error ? err.message : String(err))
    })
  }

  return NextResponse.json({ received: true })
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal notification dispatcher
// ─────────────────────────────────────────────────────────────────────────────

interface NotificationContext {
  alertChannel: string
  alertConfig: unknown
  reason: string | null
}

async function triggerDisconnectNotification(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  instanceId: string,
  ctx: NotificationContext
): Promise<void> {
  const edgeFunctionUrl = process.env.SUPABASE_EDGE_FUNCTION_NOTIFY_URL

  if (edgeFunctionUrl) {
    // Prefer calling the Supabase Edge Function when configured
    const res = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        instanceId,
        alertChannel: ctx.alertChannel,
        alertConfig: ctx.alertConfig,
        reason: ctx.reason,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Edge function responded ${res.status}: ${text}`)
    }

    return
  }

  // Fallback: record a pending notification in the log so a background job
  // or the admin dashboard can pick it up later.
  await supabase.from('notifications_log').insert({
    instance_id: instanceId,
    channel: ctx.alertChannel,
    recipient: null,
    status: 'pending',
  })
}
