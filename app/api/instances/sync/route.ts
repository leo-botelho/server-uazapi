import { NextResponse } from 'next/server'
import { requireAuth, getAdminClient } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import type { InstanceStatus } from '@/lib/uazapi/types'

/**
 * POST /api/instances/sync
 *
 * Fetches all instances from the configured uazapiGO server and:
 *  - Inserts instances not yet tracked in the database.
 *  - Repairs existing instances whose uazapi_token was stored incorrectly.
 *  - Updates status, phone, profile for ALL already-synced instances.
 *  - Configures webhooks on ALL instances (idempotent).
 *
 * Returns { imported, repaired, updated, skipped, total }
 */
export async function POST(): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  const adminClient = await getAdminClient()

  let remoteInstances: Awaited<ReturnType<typeof adminClient.listInstances>>

  try {
    remoteInstances = await adminClient.listInstances()
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[sync] uazapi listInstances error:', msg)
    return NextResponse.json(
      { error: `Falha ao buscar instâncias do uazapiGO: ${msg}` },
      { status: 502 }
    )
  }

  if (!Array.isArray(remoteInstances) || remoteInstances.length === 0) {
    return NextResponse.json({ imported: 0, repaired: 0, updated: 0, skipped: 0, total: 0 })
  }

  const supabase = await createServiceClient()

  // Fetch existing DB rows so we can diff
  const { data: existing } = await supabase
    .from('instances')
    .select('id, name, uazapi_token')

  const existingByToken = new Map((existing ?? []).map((r) => [r.uazapi_token, r]))
  const existingByName  = new Map((existing ?? []).map((r) => [r.name, r]))

  // Helper: canonical auth token for a remote instance
  const authToken = (inst: (typeof remoteInstances)[number]): string =>
    (inst.token ?? inst.id ?? '')

  // Helper: build the fields to update from a remote instance
  function instanceFields(inst: (typeof remoteInstances)[number]) {
    return {
      status: inst.status,
      phone_connected:     inst.owner ?? inst.phone ?? null,
      profile_name:        inst.profileName ?? inst.profileInfo?.name ?? null,
      profile_picture:     inst.profilePicUrl ?? inst.profileInfo?.picture ?? null,
      last_disconnected_at: inst.lastDisconnect ?? inst.lastDisconnection ?? null,
    }
  }

  const toInsert: typeof remoteInstances = []

  const toRepair: Array<{
    dbId: string
    correctToken: string
    status: InstanceStatus
    phoneConnected: string | null
    profileName: string | null
    profilePicture: string | null
    lastDisconnectedAt: string | null
  }> = []

  const toUpdate: Array<{
    dbId: string
    status: InstanceStatus
    phoneConnected: string | null
    profileName: string | null
    profilePicture: string | null
    lastDisconnectedAt: string | null
    uazapiToken: string
  }> = []

  for (const inst of remoteInstances) {
    const correct = authToken(inst)
    if (!correct) continue

    const byToken = existingByToken.get(correct)
    const byName  = existingByName.get(inst.name)
    const fields  = instanceFields(inst)

    if (byToken) {
      // Already in DB with correct token — refresh status + profile data
      toUpdate.push({
        dbId:              byToken.id,
        uazapiToken:       correct,
        status:            fields.status,
        phoneConnected:    fields.phone_connected,
        profileName:       fields.profile_name,
        profilePicture:    fields.profile_picture,
        lastDisconnectedAt: fields.last_disconnected_at,
      })
      continue
    }

    if (byName) {
      // Exists in DB but with wrong token — repair
      toRepair.push({
        dbId:              byName.id,
        correctToken:      correct,
        status:            fields.status,
        phoneConnected:    fields.phone_connected,
        profileName:       fields.profile_name,
        profilePicture:    fields.profile_picture,
        lastDisconnectedAt: fields.last_disconnected_at,
      })
    } else {
      // Brand-new instance
      toInsert.push(inst)
    }
  }

  // ── Update already-synced instances (status + profile) ───────────────────
  let updatedCount = 0
  if (toUpdate.length > 0) {
    const results = await Promise.allSettled(
      toUpdate.map(({ dbId, status, phoneConnected, profileName, profilePicture, lastDisconnectedAt }) =>
        supabase
          .from('instances')
          .update({
            status,
            ...(phoneConnected    !== null && { phone_connected: phoneConnected }),
            ...(profileName       !== null && { profile_name: profileName }),
            ...(profilePicture    !== null && { profile_picture: profilePicture }),
            ...(lastDisconnectedAt !== null && { last_disconnected_at: lastDisconnectedAt }),
          })
          .eq('id', dbId)
      )
    )
    updatedCount = results.filter((r) => r.status === 'fulfilled').length
  }

  // ── Repair wrong tokens ───────────────────────────────────────────────────
  let repairedCount = 0
  if (toRepair.length > 0) {
    const results = await Promise.allSettled(
      toRepair.map(({ dbId, correctToken, status, phoneConnected, profileName, profilePicture, lastDisconnectedAt }) =>
        supabase
          .from('instances')
          .update({
            uazapi_token: correctToken,
            status,
            ...(phoneConnected    !== null && { phone_connected: phoneConnected }),
            ...(profileName       !== null && { profile_name: profileName }),
            ...(profilePicture    !== null && { profile_picture: profilePicture }),
            ...(lastDisconnectedAt !== null && { last_disconnected_at: lastDisconnectedAt }),
          })
          .eq('id', dbId)
      )
    )
    repairedCount = results.filter((r) => r.status === 'fulfilled').length
    if (results.filter((r) => r.status === 'rejected').length > 0) {
      console.warn('[sync] Some token repairs failed')
    }
  }

  // ── Insert new instances ──────────────────────────────────────────────────
  let importedCount = 0
  if (toInsert.length > 0) {
    const rows = toInsert.map((inst) => ({
      name: inst.name,
      uazapi_token: authToken(inst),
      ...instanceFields(inst),
      active: true,
    }))

    const { error: insertError } = await supabase.from('instances').insert(rows)

    if (insertError) {
      console.error('[sync] DB insert error:', insertError.message)
      return NextResponse.json(
        { error: 'Falha ao salvar instâncias no banco de dados' },
        { status: 500 }
      )
    }

    importedCount = rows.length
  }

  // ── Configure webhooks on ALL instances (idempotent) ─────────────────────
  const webhookUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook`
    : null

  if (webhookUrl) {
    const allTokens = [
      ...toUpdate.map((r) => r.uazapiToken),
      ...toRepair.map((r) => r.correctToken),
      ...toInsert.map((inst) => authToken(inst)),
    ]
    await Promise.allSettled(
      allTokens.map((t) => adminClient.setWebhook(t, webhookUrl, ['connection']))
    )
  }

  return NextResponse.json({
    imported: importedCount,
    repaired: repairedCount,
    updated:  updatedCount,
    skipped:  0,
    total:    remoteInstances.length,
  })
}
