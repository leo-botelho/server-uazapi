import { NextRequest, NextResponse } from 'next/server'
import { getInstanceClient } from '@/lib/api-helpers'
import type { ConnectRequest, BrowserType } from '@/lib/uazapi/types'

// Public — called by the QR display component in the client portal.
// The uazapi_token is never exposed to the browser; instanceId (UUID) is safe.

const MAX_POLL_ATTEMPTS = 8   // up to ~12 seconds waiting for QR
const POLL_INTERVAL_MS  = 1500

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

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
    // 1. Trigger connect — starts QR generation on the uazapiGO side
    const connectResult = await client.connect(uazapiToken, payload)
    console.log('[connect/qr] connect response:', JSON.stringify(connectResult))

    if (connectResult.status === 'connected') {
      return NextResponse.json({ status: 'connected' })
    }

    if (connectResult.qrcode) {
      return NextResponse.json({ qrcode: connectResult.qrcode, status: connectResult.status })
    }

    // 2. QR not ready yet — poll /instance/status until it appears (up to ~12 s)
    let lastStatusResult: unknown = connectResult
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS)

      const statusResult = await client.getStatus(uazapiToken)
      lastStatusResult = statusResult
      console.log(`[connect/qr] poll ${attempt + 1}:`, JSON.stringify(statusResult))

      if (statusResult.status === 'connected') {
        return NextResponse.json({ status: 'connected' })
      }

      // getStatus returns UazapiInstance which also has a qrcode field
      if (statusResult.qrcode) {
        return NextResponse.json({ qrcode: statusResult.qrcode, status: statusResult.status })
      }
    }

    // Include last response in error to help diagnose
    const debug = JSON.stringify(lastStatusResult).slice(0, 300)
    console.error('[connect/qr] QR not generated. Last response:', debug)
    return NextResponse.json(
      { error: `QR não gerado. Resposta da instância: ${debug}` },
      { status: 502 }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[connect/qr] uazapi error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
