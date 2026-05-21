import { NextRequest, NextResponse } from 'next/server'
import { getInstanceClient, normalizePhone, isValidPhoneLength } from '@/lib/api-helpers'
import type { ConnectRequest, BrowserType } from '@/lib/uazapi/types'

// Public — called by the pairing-code component in the client portal.

const MAX_POLL_ATTEMPTS = 8   // up to ~12 seconds waiting for pair code
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
    // 1. Trigger connect — starts pairing code generation on the uazapiGO side
    const connectResult = await client.connect(uazapiToken, payload)

    if (connectResult.status === 'connected') {
      return NextResponse.json({ status: 'connected' })
    }

    // uazapiGO returns "paircode" (not "pairingCode") — normalise here
    const code = connectResult.paircode ?? connectResult.pairingCode
    if (code) {
      return NextResponse.json({ pairingCode: code, status: connectResult.status })
    }

    // 2. Code not ready yet — poll /instance/status until it appears (up to ~12 s)
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS)

      const statusResult = await client.getStatus(uazapiToken)

      if (statusResult.status === 'connected') {
        return NextResponse.json({ status: 'connected' })
      }

      // UazapiInstance also has paircode field
      const polledCode = statusResult.paircode ?? (statusResult as unknown as Record<string, unknown>)['pairingCode']
      if (polledCode && typeof polledCode === 'string') {
        return NextResponse.json({ pairingCode: polledCode, status: statusResult.status })
      }
    }

    return NextResponse.json(
      { error: 'Código de pareamento não gerado. A instância pode estar em estado inválido — tente reiniciar o runtime e conectar novamente.' },
      { status: 502 }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[connect/pair] uazapi error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
