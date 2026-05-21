import { NextResponse } from 'next/server'
import { requireAuth, getAdminClient } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * POST /api/instances/sync
 *
 * Fetches all instances from the configured uazapiGO server and:
 *  - Inserts instances not yet tracked in the database.
 *  - Repairs existing instances whose uazapi_token was stored incorrectly
 *    (e.g. previously saved inst.id instead of inst.token).
 *
 * Returns { imported, repaired, skipped, total }
 *
 * NOTE: uazapiGO returns the authentication token in the `token` field of each
 * instance object.  The `id` field (if present) is a different internal identifier
 * and must NOT be used as the authentication token.
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
    return NextResponse.json({ imported: 0, repaired: 0, skipped: 0, total: 0 })
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
    // Prefer `token` field; fall back to `id` for older server versions
    (inst.token ?? inst.id ?? '')

  const toInsert:  typeof remoteInstances = []
  const toRepair:  Array<{ dbId: string; correctToken: string; name: string; status: string }> = []

  for (const inst of remoteInstances) {
    const correct = authToken(inst)
    if (!correct) continue   // uazapiGO returned an unusable instance — skip

    const byToken = existingByToken.get(correct)
    const byName  = existingByName.get(inst.name)

    if (byToken) {
      // Already in DB with the correct token — nothing to do
      continue
    }

    if (byName) {
      // Exists in DB but with a different (wrong) token — repair it
      toRepair.push({
        dbId: byName.id,
        correctToken: correct,
        name: inst.name,
        status: inst.status,
      })
    } else {
      // New instance — insert
      toInsert.push(inst)
    }
  }

  // ── Repair existing rows ────────────────────────────────────────────────
  let repairedCount = 0
  if (toRepair.length > 0) {
    const results = await Promise.allSettled(
      toRepair.map(({ dbId, correctToken, status }) =>
        supabase
          .from('instances')
          .update({ uazapi_token: correctToken, status })
          .eq('id', dbId)
      )
    )
    repairedCount = results.filter((r) => r.status === 'fulfilled').length
    const failures = results.filter((r) => r.status === 'rejected')
    if (failures.length > 0) {
      console.warn('[sync] Some token repairs failed:', failures.length)
    }
  }

  // ── Insert new instances ────────────────────────────────────────────────
  let importedCount = 0
  if (toInsert.length > 0) {
    const rows = toInsert.map((inst) => ({
      name: inst.name,
      uazapi_token: authToken(inst),
      status: inst.status,
      phone_connected: inst.phone ?? null,
      profile_name: inst.profileInfo?.name ?? null,
      profile_picture: inst.profileInfo?.picture ?? null,
      last_disconnected_at: inst.lastDisconnection ?? null,
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

    // Configure webhooks on newly imported instances (non-fatal)
    const webhookUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook`
      : null

    if (webhookUrl) {
      await Promise.allSettled(
        rows.map((r) =>
          adminClient.setWebhook(r.uazapi_token, webhookUrl, ['connection'])
        )
      )
    }
  }

  // Also set webhooks for repaired instances (may have been missing)
  const webhookUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook`
    : null
  if (webhookUrl && toRepair.length > 0) {
    await Promise.allSettled(
      toRepair.map(({ correctToken }) =>
        adminClient.setWebhook(correctToken, webhookUrl, ['connection'])
      )
    )
  }

  const skipped = remoteInstances.length - toInsert.length - toRepair.length

  return NextResponse.json({
    imported: importedCount,
    repaired: repairedCount,
    skipped,
    total: remoteInstances.length,
  })
}
