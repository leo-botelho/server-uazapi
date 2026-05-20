import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-helpers'
import { normalizePhone, isValidPhoneLength } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'

// GET /api/clients — list all active clients
export async function GET(_request: NextRequest): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  const supabase = await createServiceClient()

  const { data: clients, error: dbError } = await supabase
    .from('clients')
    .select('id, name, email, phones, active, created_at, updated_at')
    .eq('active', true)
    .order('name', { ascending: true })

  if (dbError) {
    console.error('[clients GET] DB error:', dbError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  return NextResponse.json({ clients })
}

// POST /api/clients — create a new client
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

  const email =
    typeof raw['email'] === 'string' && raw['email'].trim() !== ''
      ? raw['email'].trim()
      : null

  // Validate and normalize phones array
  const rawPhones = Array.isArray(raw['phones']) ? raw['phones'] : []
  const phones: string[] = []

  for (const p of rawPhones) {
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

  const supabase = await createServiceClient()

  // Check for duplicate email
  if (email) {
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('email', email)
      .eq('active', true)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: 'A client with this email already exists' },
        { status: 409 }
      )
    }
  }

  const { data: client, error: insertError } = await supabase
    .from('clients')
    .insert({ name, email, phones })
    .select()
    .single()

  if (insertError) {
    console.error('[clients POST] DB insert error:', insertError.message)
    return NextResponse.json({ error: 'Failed to create client' }, { status: 500 })
  }

  return NextResponse.json({ client }, { status: 201 })
}
