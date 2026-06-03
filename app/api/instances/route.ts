import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getAdminClient } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'

// GET /api/instances — list all instances with their client relation
export async function GET(_request: NextRequest): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  // Use service client so we can join across RLS-protected tables consistently
  const supabase = await createServiceClient()

  const { data: instances, error: dbError } = await supabase
    .from('instances')
    .select(`
      id,
      name,
      status,
      phone_connected,
      profile_name,
      profile_picture,
      alert_channel,
      alert_config,
      silence_start,
      silence_end,
      last_disconnected_at,
      active,
      created_at,
      updated_at,
      client_id,
      clients (
        id,
        name,
        email,
        phones
      )
    `)
    .eq('active', true)
    .order('created_at', { ascending: false })

  if (dbError) {
    console.error('[instances GET] DB error:', dbError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return NextResponse.json({ instances })
}

// POST /api/instances — create a new instance
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>

  if (typeof raw['name'] !== 'string' || raw['name'].trim() === '') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const name = (raw['name'] as string).trim()
  const clientId = typeof raw['clientId'] === 'string' ? raw['clientId'] : null

  // 1. Create the instance in uazapiGO using the admin's configured server
  const adminClient = await getAdminClient()

  let uazapiInstance: Awaited<ReturnType<typeof adminClient.createInstance>>

  try {
    uazapiInstance = await adminClient.createInstance(name)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown uazapi error'
    console.error('[instances POST] uazapi error:', message)
    return NextResponse.json({ error: 'Failed to create instance in uazapiGO' }, { status: 502 })
  }

  // uazapiGO returns the authentication token in the `token` field.
  // Fall back to `id` for older server versions that may not have the `token` field.
  const uazapiToken = uazapiInstance.token ?? uazapiInstance.id

  if (!uazapiToken) {
    console.error('[instances POST] uazapi returned no token', uazapiInstance)
    return NextResponse.json({ error: 'uazapiGO não retornou nenhum token' }, { status: 502 })
  }

  // 2. Persist to DB
  // NOTE: Webhook is configured globally via /globalwebhook (admintoken) in uazapiGO.
  // Do NOT set per-instance webhooks here — that would overwrite AI agent webhook configs.
  const supabase = await createServiceClient()

  const { data: instance, error: insertError } = await supabase
    .from('instances')
    .insert({
      name,
      uazapi_token: uazapiToken,
      client_id: clientId,
      status: 'disconnected',
    })
    .select()
    .single()

  if (insertError) {
    console.error('[instances POST] DB insert error:', insertError.message)
    // The uazapi instance was already created; log it prominently
    console.error('[instances POST] Orphaned uazapi token:', uazapiToken)
    return NextResponse.json({ error: 'Failed to save instance' }, { status: 500 })
  }

  return NextResponse.json({ instance }, { status: 201 })
}
