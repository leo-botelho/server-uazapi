import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-helpers'

export async function GET() {
  const { error, supabase } = await requireAuth()
  if (error) return error

  const { data, error: dbError } = await supabase
    .from('servers')
    .select('id, name, url, active, created_at')  // never return admin_token to client
    .eq('active', true)
    .order('created_at', { ascending: false })

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const { error, supabase } = await requireAuth()
  if (error) return error

  const body = await request.json() as { name?: string; url?: string; admin_token?: string }
  const { name, url, admin_token } = body

  if (!name || !url || !admin_token) {
    return NextResponse.json({ error: 'name, url and admin_token are required' }, { status: 400 })
  }

  // Normalize URL: strip trailing slash
  const normalizedUrl = url.replace(/\/$/, '')

  const { data, error: dbError } = await supabase
    .from('servers')
    .insert({ name, url: normalizedUrl, admin_token })
    .select('id, name, url, active, created_at')
    .single()

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json(data, { status: 201 })
}
