import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getInstanceClient } from '@/lib/api-helpers'
import { normalizePhone, isValidPhoneLength } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'

// POST /api/instances/[id]/connect — connect from the admin panel
// Body (optional): { phone?: string }
// Omitting phone → QR code mode; providing phone → pairing code mode.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  const { id } = await params

  let body: Record<string, unknown> = {}

  try {
    const parsed = await request.json()
    if (typeof parsed === 'object' && parsed !== null) {
      body = parsed as Record<string, unknown>
    }
  } catch {
    // Body is optional for QR mode — ignore parse errors on empty bodies
  }

  let phone: string | undefined

  if (typeof body['phone'] === 'string' && body['phone'].trim() !== '') {
    phone = normalizePhone(body['phone'])
    if (!isValidPhoneLength(phone)) {
      return NextResponse.json(
        { error: 'phone must have between 10 and 13 digits' },
        { status: 400 }
      )
    }
  }

  // Check instance status before attempting to connect
  const supabase = await createServiceClient()

  const { data: instance, error: dbError } = await supabase
    .from('instances')
    .select('status')
    .eq('id', id)
    .eq('active', true)
    .maybeSingle()

  if (dbError) {
    console.error('[instances/[id]/connect POST] DB error:', dbError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
  }

  if (instance.status === 'connected') {
    return NextResponse.json({ status: 'connected' })
  }

  // Resolve the correct uazapiGO client for this instance (server-aware)
  const resolved = await getInstanceClient(id)

  if (!resolved) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
  }

  const { client, uazapiToken, proxyCity, proxyState } = resolved

  // Build connect payload with optional managed proxy from the client's city
  const proxyParams = proxyCity
    ? {
        proxy_managed_country: 'br' as const,
        ...(proxyState ? { proxy_managed_state: proxyState } : {}),
        proxy_managed_city: proxyCity,
      }
    : {}

  let connectResult: Awaited<ReturnType<typeof client.connect>>

  try {
    connectResult = await client.connect(uazapiToken, {
      ...(phone ? { phone } : {}),
      ...proxyParams,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown uazapi error'
    console.error('[instances/[id]/connect POST] uazapi error:', message)
    return NextResponse.json({ error: 'Failed to connect instance' }, { status: 502 })
  }

  return NextResponse.json({
    status: connectResult.status,
    ...(connectResult.qrcode ? { qrcode: connectResult.qrcode } : {}),
    ...(connectResult.pairingCode ? { pairingCode: connectResult.pairingCode } : {}),
  })
}
