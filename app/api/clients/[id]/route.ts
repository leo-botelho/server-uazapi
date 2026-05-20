import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-helpers'
import { normalizePhone, isValidPhoneLength } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/types/database'

type ClientUpdate = Database['public']['Tables']['clients']['Update']

// GET /api/clients/[id] — get a single client with their instances
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  const { id } = await params
  const supabase = await createServiceClient()

  const { data: client, error: dbError } = await supabase
    .from('clients')
    .select(`
      id,
      name,
      email,
      phones,
      active,
      created_at,
      updated_at,
      instances (
        id,
        name,
        status,
        phone_connected,
        alert_channel,
        last_disconnected_at,
        active,
        created_at
      )
    `)
    .eq('id', id)
    .maybeSingle()

  if (dbError) {
    console.error('[clients/[id] GET] DB error:', dbError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  return NextResponse.json({ client })
}

// PATCH /api/clients/[id] — update client fields
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
  const update: ClientUpdate = {}

  if (typeof raw['name'] === 'string' && raw['name'].trim() !== '') {
    update.name = raw['name'].trim()
  }

  if ('email' in raw) {
    update.email =
      typeof raw['email'] === 'string' && raw['email'].trim() !== ''
        ? raw['email'].trim()
        : null
  }

  if ('phones' in raw) {
    if (!Array.isArray(raw['phones'])) {
      return NextResponse.json({ error: 'phones must be an array' }, { status: 400 })
    }

    const phones: string[] = []

    for (const p of raw['phones'] as unknown[]) {
      if (typeof p !== 'string') {
        return NextResponse.json(
          { error: 'Each item in phones must be a string' },
          { status: 400 }
        )
      }

      const normalized = normalizePhone(p)

      if (!isValidPhoneLength(normalized)) {
        return NextResponse.json(
          { error: `Invalid phone number: ${p}` },
          { status: 400 }
        )
      }

      phones.push(normalized)
    }

    update.phones = phones
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const supabase = await createServiceClient()

  // Check for email uniqueness if we're updating the email
  if (update.email) {
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('email', update.email)
      .eq('active', true)
      .neq('id', id)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: 'Another client with this email already exists' },
        { status: 409 }
      )
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from('clients')
    .update(update)
    .eq('id', id)
    .select()
    .maybeSingle()

  if (updateError) {
    console.error('[clients/[id] PATCH] DB update error:', updateError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!updated) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  return NextResponse.json({ client: updated })
}

// DELETE /api/clients/[id] — soft delete
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  const { id } = await params
  const supabase = await createServiceClient()

  const { data: updated, error: updateError } = await supabase
    .from('clients')
    .update({ active: false })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (updateError) {
    console.error('[clients/[id] DELETE] DB error:', updateError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!updated) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
