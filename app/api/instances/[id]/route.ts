import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-helpers'
import { uazapi } from '@/lib/uazapi/client'
import { createServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type InstanceUpdate = Database['public']['Tables']['instances']['Update']

// GET /api/instances/[id]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  const { id } = await params
  const supabase = await createServiceClient()

  const { data: instance, error: dbError } = await supabase
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
    .eq('id', id)
    .maybeSingle()

  if (dbError) {
    console.error('[instances/[id] GET] DB error:', dbError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
  }

  return NextResponse.json({ instance })
}

// DELETE /api/instances/[id] — soft delete + uazapi deletion
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  const { id } = await params
  const supabase = await createServiceClient()

  // Fetch the token first
  const { data: instance, error: findError } = await supabase
    .from('instances')
    .select('uazapi_token, active')
    .eq('id', id)
    .maybeSingle()

  if (findError) {
    console.error('[instances/[id] DELETE] DB lookup error:', findError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
  }

  // Soft-delete in DB first so the record is marked inactive even if uazapi fails
  const { error: updateError } = await supabase
    .from('instances')
    .update({ active: false })
    .eq('id', id)

  if (updateError) {
    console.error('[instances/[id] DELETE] DB soft-delete error:', updateError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  // Best-effort deletion from uazapiGO
  try {
    await uazapi.deleteInstance(instance.uazapi_token)
  } catch (err) {
    console.warn(
      '[instances/[id] DELETE] uazapi delete failed (soft-delete already done):',
      err instanceof Error ? err.message : err
    )
  }

  return NextResponse.json({ success: true })
}

// PATCH /api/instances/[id] — update name, client_id, alert settings
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  const { id } = await params

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

  // Build update payload from allowed fields only
  const update: InstanceUpdate = {}

  if (typeof raw['name'] === 'string' && raw['name'].trim() !== '') {
    update.name = raw['name'].trim()
  }

  if ('clientId' in raw) {
    update.client_id = typeof raw['clientId'] === 'string' ? raw['clientId'] : null
  }

  if (
    typeof raw['alertChannel'] === 'string' &&
    ['email', 'whatsapp', 'n8n', 'none'].includes(raw['alertChannel'])
  ) {
    update.alert_channel = raw['alertChannel'] as InstanceUpdate['alert_channel']
  }

  if ('alertConfig' in raw && typeof raw['alertConfig'] === 'object') {
    update.alert_config = raw['alertConfig'] as InstanceUpdate['alert_config']
  }

  if (typeof raw['silenceStart'] === 'number') {
    update.silence_start = raw['silenceStart']
  }

  if (typeof raw['silenceEnd'] === 'number') {
    update.silence_end = raw['silenceEnd']
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const supabase = await createServiceClient()

  // If renaming, propagate to uazapiGO as well
  if (update.name) {
    const { data: inst, error: findError } = await supabase
      .from('instances')
      .select('uazapi_token')
      .eq('id', id)
      .maybeSingle()

    if (findError) {
      console.error('[instances/[id] PATCH] DB lookup error:', findError.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    if (!inst) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
    }

    try {
      await uazapi.updateName(inst.uazapi_token, update.name)
    } catch (err) {
      console.warn('[instances/[id] PATCH] uazapi rename failed:', err instanceof Error ? err.message : err)
      // Non-fatal — DB rename still proceeds
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from('instances')
    .update(update)
    .eq('id', id)
    .select()
    .maybeSingle()

  if (updateError) {
    console.error('[instances/[id] PATCH] DB update error:', updateError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!updated) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
  }

  return NextResponse.json({ instance: updated })
}
