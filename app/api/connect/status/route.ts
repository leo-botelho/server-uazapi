import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Public — polled by client components.
// Status is read from the DB (kept in sync by the webhook) rather than
// querying uazapiGO on every poll, which would hammer the API.

export async function GET(request: NextRequest): Promise<NextResponse> {
  const instanceId = request.nextUrl.searchParams.get('instanceId')

  if (!instanceId || instanceId.trim() === '') {
    return NextResponse.json({ error: 'instanceId query param is required' }, { status: 400 })
  }

  const supabase = await createServiceClient()

  const { data: instance, error: dbError } = await supabase
    .from('instances')
    .select('status, phone_connected')
    .eq('id', instanceId)
    .eq('active', true)
    .maybeSingle()

  if (dbError) {
    console.error('[connect/status] DB error:', dbError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
  }

  return NextResponse.json({
    status: instance.status,
    ...(instance.phone_connected ? { phone: instance.phone_connected } : {}),
  })
}
