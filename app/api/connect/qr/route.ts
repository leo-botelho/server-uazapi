import { NextRequest, NextResponse } from 'next/server'
import { getInstanceClient } from '@/lib/api-helpers'
import type { ConnectRequest, BrowserType } from '@/lib/uazapi/types'

// Public — called by the QR display component in the client portal.
// The uazapi_token is never exposed to the browser; instanceId (UUID) is safe.

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null || !('instanceId' in body)) {
    return NextResponse.json({ error: 'instanceId is required' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>
  const instanceId = raw['instanceId']
  if (typeof instanceId !== 'string' || !instanceId.trim()) {
    return NextResponse.json({ error: 'instanceId must be a non-empty string' }, { status: 400 })
  }

  const resolved = await getInstanceClient(instanceId)
  if (!resolved) return NextResponse.json({ error: 'Instance not found' }, { status: 404 })

  const { client, uazapiToken, proxyCity, proxyState } = resolved

  // Build connect payload — QR mode (no phone).
  // Proxy is always taken from the client's configured city in the DB;
  // body proxy params are ignored to prevent tampering.
  const payload: ConnectRequest = {}
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

    if (!result.qrcode) {
      return NextResponse.json({ error: 'No QR code returned by the instance' }, { status: 502 })
    }

    return NextResponse.json({ qrcode: result.qrcode, status: result.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[connect/qr] uazapi error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
