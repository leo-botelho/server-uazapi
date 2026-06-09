import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getAdminClient } from '@/lib/api-helpers'
import type { GlobalWebhookConfig } from '@/lib/uazapi/types'

// GET /api/webhook/global — ler configuração atual do webhook global do uazapiGO
export async function GET(_request: NextRequest): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  const adminClient = await getAdminClient()

  try {
    const config = await adminClient.getGlobalWebhook()
    return NextResponse.json(config)
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    // 404 = ainda não configurado — retorna null para que o formulário mostre estado vazio
    if (message.includes('404') || message.toLowerCase().includes('not found')) {
      return NextResponse.json(null)
    }
    console.error('[webhook/global GET] error:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

// POST /api/webhook/global — criar ou atualizar o webhook global no uazapiGO
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const raw = body as Record<string, unknown>

  if (typeof raw['url'] !== 'string' || !raw['url'].trim()) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 })
  }

  if (!Array.isArray(raw['events']) || (raw['events'] as unknown[]).length === 0) {
    return NextResponse.json({ error: 'events must be a non-empty array' }, { status: 400 })
  }

  const config: GlobalWebhookConfig = {
    url: (raw['url'] as string).trim(),
    enabled: true,   // always activate — GET /globalwebhook shows enabled:false when omitted
    events: raw['events'] as GlobalWebhookConfig['events'],
    excludeMessages: Array.isArray(raw['excludeMessages'])
      ? (raw['excludeMessages'] as GlobalWebhookConfig['excludeMessages'])
      : [],
  }

  const adminClient = await getAdminClient()

  try {
    const result = await adminClient.setGlobalWebhook(config)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[webhook/global POST] error:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
