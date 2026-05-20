import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createUazapi, uazapi } from '@/lib/uazapi/client'

// Fetches proxy city list from the appropriate uazapiGO server.
// Uses the same 3-tier fallback as getInstanceClient:
//   1. Specific server by ID (query param)
//   2. Env var UAZAPI_BASE_URL / UAZAPI_ADMIN_TOKEN (Cloudflare Worker secret)
//   3. admin_profiles table (server URL configured in the profile page)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const country = searchParams.get('country') ?? 'br'
  const serverId = searchParams.get('serverId')

  const supabase = await createServiceClient()
  let resolvedClient = null

  // Tier 1: specific server by ID
  if (serverId) {
    const { data: server } = await supabase
      .from('servers')
      .select('url, admin_token')
      .eq('id', serverId)
      .eq('active', true)
      .single()

    if (server) {
      resolvedClient = createUazapi(server.url, server.admin_token)
    }
  }

  // Tier 2: env var configured (Cloudflare Worker runtime secret)
  if (!resolvedClient && process.env.UAZAPI_BASE_URL && process.env.UAZAPI_ADMIN_TOKEN) {
    resolvedClient = uazapi
  }

  // Tier 3: admin_profiles — most common case when server URL is saved in the profile
  if (!resolvedClient) {
    const { data: profile } = await supabase
      .from('admin_profiles')
      .select('uazapi_server_url, uazapi_admin_token')
      .neq('uazapi_server_url', '')
      .neq('uazapi_admin_token', '')
      .limit(1)
      .maybeSingle()

    if (profile?.uazapi_server_url && profile?.uazapi_admin_token) {
      resolvedClient = createUazapi(profile.uazapi_server_url, profile.uazapi_admin_token)
    }
  }

  // Ultimate fallback
  const client = resolvedClient ?? uazapi

  try {
    const cities = await client.getCities(country)
    return NextResponse.json(cities)
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 }
    )
  }
}
