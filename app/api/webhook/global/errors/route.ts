import { NextResponse } from 'next/server'
import { requireAuth, getAdminClient } from '@/lib/api-helpers'

/**
 * GET /api/webhook/global/errors — erros de entrega do webhook global.
 *
 * É a saúde do próprio painel: esse webhook é o que alimenta o status das
 * instâncias. Se ele estiver falhando, o painel fica cego sem saber — foi
 * exatamente o que aconteceu quando ele apareceu como `enabled: false`.
 */
export async function GET(): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const adminClient = await getAdminClient()

  try {
    const errors = await adminClient.getGlobalWebhookErrors()
    return NextResponse.json({ errors })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    // 404 = o servidor não expõe o endpoint; não é falha do painel.
    if (message.includes('404')) {
      return NextResponse.json({ errors: [], unsupported: true })
    }
    console.error('[webhook/global/errors GET] error:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
