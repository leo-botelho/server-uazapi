import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getInstanceClient } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'

// POST /api/instances/[id]/disconnect

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  const { id } = await params
  const supabase = await createServiceClient()

  const { data: instance, error: dbError } = await supabase
    .from('instances')
    .select('uazapi_token, status')
    .eq('id', id)
    .eq('active', true)
    .maybeSingle()

  if (dbError) {
    console.error('[instances/[id]/disconnect POST] DB error:', dbError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
  }

  if (instance.status === 'disconnected') {
    return NextResponse.json({ status: 'disconnected' })
  }

  try {
    // Resolve o servidor da própria instância. Usar o client global mandava a
    // ordem para o servidor errado quando a instância pertencia a outro server.
    const resolved = await getInstanceClient(id)
    if (!resolved) throw new Error('Servidor da instância não resolvido')
    await resolved.client.disconnect(resolved.uazapiToken)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown uazapi error'
    console.error('[instances/[id]/disconnect POST] uazapi error:', message)
    return NextResponse.json({ error: 'Failed to disconnect instance' }, { status: 502 })
  }

  // Optimistically update status in DB — the webhook will confirm it shortly
  await supabase
    .from('instances')
    .update({ status: 'disconnected', last_disconnected_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ status: 'disconnected' })
}
