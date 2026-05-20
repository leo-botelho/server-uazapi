import { NextRequest, NextResponse } from 'next/server'
import { getInstanceClient, normalizePhone, isValidPhoneLength } from '@/lib/api-helpers'
import type { ConnectRequest, BrowserType } from '@/lib/uazapi/types'

// Public — called by the pairing-code component in the client portal.

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  if (typeof raw['instanceId'] !== 'string' || !raw['instanceId'].trim()) {
    return NextResponse.json({ error: 'instanceId is required' }, { status: 400 })
  }
  if (typeof raw['phone'] !== 'string' || !raw['phone'].trim()) {
    return NextResponse.json({ error: 'phone is required' }, { status: 400 })
  }

  const instanceId = raw['instanceId'] as string
  const phone = normalizePhone(raw['phone'] as string)

  if (!isValidPhoneLength(phone)) {
    return NextResponse.json({ error: 'phone must have between 10 and 13 digits' }, { status: 400 })
  }

  const resolved = await getInstanceClient(instanceId)
  if (!resolved) return NextResponse.json({ error: 'Instance not found' }, { status: 404 })

  const { client, uazapiToken, proxyCity, proxyState } = resolved

  // Build connect payload — pairing code mode (phone required).
  // Proxy is always taken from the client's configured city in the DB;
  // body proxy params are ignored to prevent tampering.
  const payload: ConnectRequest = { phone }
  if (typeof raw['browser'] === 'string') payload.browser = raw['browser'] as BrowserType
  if (typeof raw['systemName'] === 'string') payload.systemName = raw['systemName']
  if (proxyCity) {
    payload.proxy_managed_country = 'br'
    if (proxyState) payload.proxy_managed_state = proxyState
    payload.proxy_managed_city = proxyCity
  }

  try {
    const result = await client.connect(uazapiToken, payload)

    if (result.status === 'connected') return NextResponse.json({ status: 'connected' })

    if (!result.pairingCode) {
      return NextResponse.json({ error: 'No pairing code returned by the instance' }, { status: 502 })
    }

    return NextResponse.json({ pairingCode: result.pairingCode, status: result.status })
  } catch (err) {
    console.error('[connect/pair] uazapi error:', (err as Error).message)
    return NextResponse.json({ error: 'Failed to request pairing code' }, { status: 502 })
  }
}
