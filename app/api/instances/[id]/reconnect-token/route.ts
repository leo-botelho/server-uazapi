import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'

// POST /api/instances/[id]/reconnect-token
// Generates a time-limited reconnect token that allows the client portal to
// reconnect a specific instance without logging into the admin panel.

const TOKEN_TTL_HOURS = 72

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error } = await requireAuth()
  if (error) return error

  const { id } = await params
  const supabase = await createServiceClient()

  // Verify the instance exists and is active
  const { data: instance, error: dbError } = await supabase
    .from('instances')
    .select('id')
    .eq('id', id)
    .eq('active', true)
    .maybeSingle()

  if (dbError) {
    console.error('[reconnect-token POST] DB error:', dbError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString()

  const { data: reconnectToken, error: insertError } = await supabase
    .from('reconnect_tokens')
    .insert({
      instance_id: id,
      token,
      expires_at: expiresAt,
    })
    .select('token, expires_at')
    .single()

  if (insertError) {
    console.error('[reconnect-token POST] DB insert error:', insertError.message)
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const reconnectUrl = `${appUrl}/connect/${reconnectToken.token}`

  return NextResponse.json(
    {
      token: reconnectToken.token,
      expiresAt: reconnectToken.expires_at,
      reconnectUrl,
    },
    { status: 201 }
  )
}
