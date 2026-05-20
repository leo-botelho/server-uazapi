import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-helpers'
import { uazapi } from '@/lib/uazapi/client'
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
    await uazapi.disconnect(instance.uazapi_token)
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
