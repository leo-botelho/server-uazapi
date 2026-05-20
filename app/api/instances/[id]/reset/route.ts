import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getInstanceClient } from '@/lib/api-helpers'

// POST /api/instances/[id]/reset
// Restarts the uazapiGO runtime without disconnecting the session.
// Useful when the instance is in a bad state but still authenticated.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  const { id } = await params
  const result = await getInstanceClient(id)

  if (!result) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
  }

  const { client, uazapiToken } = result

  try {
    await client.resetInstance(uazapiToken)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[reset] uazapi error:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  return NextResponse.json({ success: true })
}
