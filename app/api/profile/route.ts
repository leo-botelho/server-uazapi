import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'

// GET /api/profile — returns the current admin's profile (token is masked)
export async function GET(): Promise<NextResponse> {
  const { error, user } = await requireAuth()
  if (error) return error

  const serviceClient = await createServiceClient()

  const { data: profile, error: dbError } = await serviceClient
    .from('admin_profiles')
    .select('id, full_name, uazapi_server_url, uazapi_admin_token, created_at')
    .eq('id', user.id)
    .maybeSingle()

  if (dbError) {
    console.error('[profile GET] DB error:', dbError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!profile) {
    // Profile doesn't exist yet (user created before the trigger was added).
    // Auto-create a default row so the Profile page works immediately.
    const { data: created, error: createError } = await serviceClient
      .from('admin_profiles')
      .insert({ id: user.id })
      .select('id, full_name, uazapi_server_url, uazapi_admin_token, created_at')
      .single()

    if (createError) {
      // Possible race condition (concurrent request already created it) — ignore
      console.warn('[profile GET] Could not auto-create profile:', createError.message)
      return NextResponse.json(null)
    }

    return NextResponse.json({
      id: created.id,
      full_name: created.full_name,
      uazapi_server_url: created.uazapi_server_url,
      uazapi_admin_token_set: false,
      created_at: created.created_at,
    })
  }

  return NextResponse.json({
    id: profile.id,
    full_name: profile.full_name,
    uazapi_server_url: profile.uazapi_server_url,
    uazapi_admin_token_set: profile.uazapi_admin_token !== '',
    created_at: profile.created_at,
  })
}

// PATCH /api/profile — upserts the admin profile
export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const { error, user } = await requireAuth()
  if (error) return error

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

  const patch: {
    id: string
    full_name?: string | null
    uazapi_server_url?: string
    uazapi_admin_token?: string
  } = { id: user.id }

  if ('full_name' in raw) {
    patch.full_name =
      typeof raw['full_name'] === 'string' && raw['full_name'].trim() !== ''
        ? raw['full_name'].trim()
        : null
  }

  if (typeof raw['uazapi_server_url'] === 'string') {
    // Strip trailing slash for consistency
    patch.uazapi_server_url = raw['uazapi_server_url'].replace(/\/$/, '')
  }

  if (typeof raw['uazapi_admin_token'] === 'string' && raw['uazapi_admin_token'].trim() !== '') {
    patch.uazapi_admin_token = raw['uazapi_admin_token'].trim()
  }

  const serviceClient = await createServiceClient()

  const { data: profile, error: dbError } = await serviceClient
    .from('admin_profiles')
    .upsert(patch, { onConflict: 'id' })
    .select('id, full_name, uazapi_server_url, uazapi_admin_token, created_at')
    .single()

  if (dbError) {
    console.error('[profile PATCH] DB error:', dbError.message)
    return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
  }

  return NextResponse.json({
    id: profile.id,
    full_name: profile.full_name,
    uazapi_server_url: profile.uazapi_server_url,
    uazapi_admin_token_set: profile.uazapi_admin_token !== '',
    created_at: profile.created_at,
  })
}
