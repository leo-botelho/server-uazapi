import { NextResponse } from 'next/server'
import { requireAuth, getAdminClient } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * POST /api/instances/sync
 *
 * Fetches all instances from the configured uazapiGO server and imports any
 * that are not yet tracked in the database. Existing rows (matched by
 * uazapi_token) are skipped to avoid overwriting user-set data (client_id etc).
 *
 * Returns { imported, skipped, total }
 */
export async function POST(): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  const adminClient = await getAdminClient()

  // Fetch all instances from uazapiGO
  let remoteInstances: Awaited<ReturnType<typeof adminClient.listInstances>>

  try {
    remoteInstances = await adminClient.listInstances()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[sync] uazapi listInstances error:', msg)
    return NextResponse.json(
      { error: `Failed to fetch instances from uazapiGO: ${msg}` },
      { status: 502 }
    )
  }

  if (!Array.isArray(remoteInstances) || remoteInstances.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0, total: 0 })
  }

  const supabase = await createServiceClient()

  // Get all tokens already in the DB so we can skip them
  const { data: existing } = await supabase
    .from('instances')
    .select('uazapi_token')

  const existingTokens = new Set((existing ?? []).map((r) => r.uazapi_token))

  // Build rows to insert (only the ones not yet tracked)
  const toInsert = remoteInstances
    .filter((inst) => !existingTokens.has(inst.id))
    .map((inst) => ({
      name: inst.name,
      uazapi_token: inst.id,
      status: inst.status,
      phone_connected: inst.phone ?? null,
      profile_name: inst.profileInfo?.name ?? null,
      profile_picture: inst.profileInfo?.picture ?? null,
      last_disconnected_at: inst.lastDisconnection ?? null,
      active: true,
    }))

  const skipped = remoteInstances.length - toInsert.length

  if (toInsert.length === 0) {
    return NextResponse.json({
      imported: 0,
      skipped,
      total: remoteInstances.length,
    })
  }

  const { error: insertError } = await supabase
    .from('instances')
    .insert(toInsert)

  if (insertError) {
    console.error('[sync] DB insert error:', insertError.message)
    return NextResponse.json(
      { error: 'Failed to save instances to database' },
      { status: 500 }
    )
  }

  // Also configure webhooks on the newly imported instances so we receive
  // connection events going forward (non-fatal if it fails)
  const webhookUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook`
    : null

  if (webhookUrl) {
    await Promise.allSettled(
      toInsert.map((inst) =>
        adminClient.setWebhook(inst.uazapi_token, webhookUrl, ['connection'])
      )
    )
  }

  return NextResponse.json({
    imported: toInsert.length,
    skipped,
    total: remoteInstances.length,
  })
}
