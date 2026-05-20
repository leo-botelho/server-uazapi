import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizePhone, isValidPhoneLength } from '@/lib/api-helpers'

// Public — used by the client self-service portal to find their instance.

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null || !('phone' in body)) {
    return NextResponse.json({ error: 'phone is required' }, { status: 400 })
  }

  const rawPhone = (body as Record<string, unknown>)['phone']

  if (typeof rawPhone !== 'string' || rawPhone.trim() === '') {
    return NextResponse.json({ error: 'phone must be a non-empty string' }, { status: 400 })
  }

  const phone = normalizePhone(rawPhone)

  if (!isValidPhoneLength(phone)) {
    return NextResponse.json(
      { error: 'phone must have between 10 and 13 digits' },
      { status: 400 }
    )
  }

  const supabase = await createServiceClient()

  // Build a list of phone variants to try (with and without Brazilian DDI 55).
  // This tolerates admins who stored the number with vs. without the country code.
  const phoneVariants: string[] = [phone]
  if (phone.startsWith('55') && phone.length >= 12) {
    // e.g. "5511999999999" → also try "11999999999"
    phoneVariants.push(phone.slice(2))
  } else if (!phone.startsWith('55') && phone.length <= 11) {
    // e.g. "11999999999" → also try "5511999999999"
    phoneVariants.push('55' + phone)
  }

  // Search for a client whose phones array contains any of the variants.
  let client: { id: string } | null = null
  for (const variant of phoneVariants) {
    const { data, error: clientError } = await supabase
      .from('clients')
      .select('id')
      .eq('active', true)
      .contains('phones', [variant])
      .maybeSingle()

    if (clientError) {
      console.error('[connect/lookup] Client lookup error:', clientError.message)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }

    if (data) {
      client = data
      break
    }
  }

  if (!client) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Find the first active instance for this client
  const { data: instance, error: instanceError } = await supabase
    .from('instances')
    .select('id, name, status')
    .eq('client_id', client.id)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (instanceError) {
    console.error('[connect/lookup] Instance lookup error:', instanceError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!instance) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Return only non-sensitive data.
  // The uazapi_token is never sent to the browser — QR and pair routes
  // look it up server-side using the instanceId UUID.
  return NextResponse.json({
    instanceId: instance.id,
    instanceName: instance.name,
    status: instance.status,
  })
}
