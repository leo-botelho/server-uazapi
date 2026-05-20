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

  const { client, uazapiToken } = resolved

  // Build connect payload — QR mode (no phone)
  const payload: ConnectRequest = {}
  if (typeof raw['browser'] === 'string') payload.browser = raw['browser'] as BrowserType
  if (typeof raw['systemName'] === 'string') payload.systemName = raw['systemName']
  if (typeof raw['proxy_managed_country'] === 'string') payload.proxy_managed_country = raw['proxy_managed_country']
  if (typeof raw['proxy_managed_state'] === 'string') payload.proxy_managed_state = raw['proxy_managed_state']
  if (typeof raw['proxy_managed_city'] === 'string') payload.proxy_managed_city = raw['proxy_managed_city']

  try {
    const result = await client.connect(uazapiToken, payload)

    if (result.status === 'connected') return NextResponse.json({ status: 'connected' })

    if (!result.qrcode) {
      return NextResponse.json({ error: 'No QR code returned by the instance' }, { status: 502 })
    }

    return NextResponse.json({ qrcode: result.qrcode, status: result.status })
  } catch (err) {
    console.error('[connect/qr] uazapi error:', (err as Error).message)
    return NextResponse.json({ error: 'Failed to request QR code' }, { status: 502 })
  }
}
