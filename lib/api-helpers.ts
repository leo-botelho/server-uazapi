import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createUazapi, uazapi } from '@/lib/uazapi/client'
import type { UazapiClient } from '@/lib/uazapi/client'
import { NextResponse } from 'next/server'

type ResolvedSupabase = Awaited<ReturnType<typeof createClient>>
type ResolvedUser = NonNullable<
  Awaited<ReturnType<ResolvedSupabase['auth']['getUser']>>['data']['user']
>

export type AuthSuccess = { user: ResolvedUser; supabase: ResolvedSupabase; error: null }
export type AuthFailure = { user: null; supabase: ResolvedSupabase; error: NextResponse }
export type AuthResult = AuthSuccess | AuthFailure

/**
 * Verifies the current session via the Supabase auth cookie.
 * Returns `error` (a 401 NextResponse) when there is no authenticated user
 * so callers can early-return: `const { error } = await requireAuth(); if (error) return error`
 */
export async function requireAuth(): Promise<AuthResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      user: null,
      supabase,
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }

  return { user, supabase, error: null }
}

/**
 * Resolves the correct uazapiGO client for a given instance.
 * If the instance has a server_id, loads that server's URL + token from DB.
 * Falls back to the env-var default client when no server is linked.
 */
export async function getInstanceClient(instanceId: string): Promise<{
  client: UazapiClient
  uazapiToken: string
} | null> {
  const supabase = await createServiceClient()

  const { data: instance } = await supabase
    .from('instances')
    .select('uazapi_token, server_id, servers(url, admin_token)')
    .eq('id', instanceId)
    .single()

  if (!instance) return null

  const uazapiToken = instance.uazapi_token
  const server = Array.isArray(instance.servers) ? instance.servers[0] : instance.servers

  // 1. Instance has a dedicated server record → highest priority
  if (server?.url && server?.admin_token) {
    return { client: createUazapi(server.url, server.admin_token), uazapiToken }
  }

  // 2. Env var configured (Cloudflare Worker runtime secret)
  if (process.env.UAZAPI_BASE_URL && process.env.UAZAPI_ADMIN_TOKEN) {
    return { client: uazapi, uazapiToken }
  }

  // 3. Fall back to admin profile — covers instances synced before server_id was set
  //    and environments where env vars aren't configured yet
  const { data: profile } = await supabase
    .from('admin_profiles')
    .select('uazapi_server_url, uazapi_admin_token')
    .neq('uazapi_server_url', '')
    .neq('uazapi_admin_token', '')
    .limit(1)
    .maybeSingle()

  if (profile?.uazapi_server_url && profile?.uazapi_admin_token) {
    return {
      client: createUazapi(profile.uazapi_server_url, profile.uazapi_admin_token),
      uazapiToken,
    }
  }

  // Ultimate fallback — will use free.uazapi.com default, likely to fail
  return { client: uazapi, uazapiToken }
}

/**
 * Resolves the correct uazapiGO client for the currently authenticated admin.
 * Reads the admin's profile from admin_profiles and uses their configured
 * server URL + token. Falls back to the env-var default when no profile exists
 * or the profile fields are empty.
 */
export async function getAdminClient(): Promise<UazapiClient> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return uazapi

  const serviceClient = await createServiceClient()
  const { data: profile } = await serviceClient
    .from('admin_profiles')
    .select('uazapi_server_url, uazapi_admin_token')
    .eq('id', user.id)
    .single()

  if (profile?.uazapi_server_url && profile?.uazapi_admin_token) {
    return createUazapi(profile.uazapi_server_url, profile.uazapi_admin_token)
  }

  return uazapi
}

/** Strip all non-digit characters from a phone string. */
export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '')
}

/** Return true if the phone has between 10 and 13 digits (international range). */
export function isValidPhoneLength(phone: string): boolean {
  return phone.length >= 10 && phone.length <= 13
}
