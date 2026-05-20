import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createUazapi, uazapi } from '@/lib/uazapi/client'

// Public endpoint — used by connect portal and admin connect modal
// Fetches proxy city list from the appropriate uazapiGO server
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const country = searchParams.get('country') ?? 'br'
  const serverId = searchParams.get('serverId')

  let client = uazapi

  if (serverId) {
    const supabase = await createServiceClient()
    const { data: server } = await supabase
      .from('servers')
      .select('url, admin_token')
      .eq('id', serverId)
      .eq('active', true)
      .single()

    if (server) {
      client = createUazapi(server.url, server.admin_token)
    }
  }

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
