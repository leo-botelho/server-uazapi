import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getInstanceClient } from '@/lib/api-helpers'

/**
 * POST /api/instances/[id]/proxy — troca ou rotaciona o proxy da instância.
 *
 * `rotate_now: true` com `mode: 'internal'` troca o IP na hora: é a tentativa de
 * recuperação mais barata quando o IP atual está queimado, antes de pedir uma
 * reconexão com QR code ao cliente.
 *
 * A API responde 200 apenas confirmando que gravou — a validação real acontece
 * no próximo ciclo de conexão. Por isso relemos o estado logo depois.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const { id } = await params

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    // corpo vazio = rotacionar o proxy interno
  }

  const mode = typeof body['mode'] === 'string' ? body['mode'] : 'internal'
  if (mode !== 'custom' && mode !== 'internal' && mode !== 'none') {
    return NextResponse.json({ error: 'mode deve ser custom, internal ou none' }, { status: 400 })
  }

  const resolved = await getInstanceClient(id)
  if (!resolved) {
    return NextResponse.json({ error: 'Instância não encontrada' }, { status: 404 })
  }

  const payload: Parameters<typeof resolved.client.setProxy>[1] = { mode }

  if (mode === 'custom') {
    const proxyUrl = typeof body['proxy_url'] === 'string' ? body['proxy_url'].trim() : ''
    if (!proxyUrl) {
      return NextResponse.json({ error: 'proxy_url é obrigatório quando mode = custom' }, { status: 400 })
    }
    payload.proxy_url = proxyUrl
  }

  if (mode === 'none') payload.confirm_no_proxy = true
  if (mode === 'internal' && body['rotate_now'] !== false) payload.rotate_now = true

  try {
    const result = await resolved.client.setProxy(resolved.uazapiToken, payload)

    // Confirma o que de fato ficou valendo.
    const current = await resolved.client
      .getProxy(resolved.uazapiToken)
      .catch(() => null)

    return NextResponse.json({
      rotated: result.rotated ?? false,
      restartRequested: result.restart_requested ?? false,
      details: result.details ?? null,
      proxy: current ?? result.proxy ?? null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[instances/[id]/proxy POST] uazapi error:', message)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
