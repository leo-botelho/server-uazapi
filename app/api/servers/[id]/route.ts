import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api-helpers'

type Params = Promise<{ id: string }>

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { error, supabase } = await requireAuth()
  if (error) return error

  const { id } = await params

  const { data, error: dbError } = await supabase
    .from('servers')
    .select('id, name, url, active, created_at')
    .eq('id', id)
    .single()

  if (dbError || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest, { params }: { params: Params }) {
  const { error, supabase } = await requireAuth()
  if (error) return error

  const { id } = await params
  const body = await request.json() as {
    name?: string
    url?: string
    admin_token?: string
    active?: boolean
  }

  type ServerUpdate = {
    name?: string
    url?: string
    admin_token?: string
    active?: boolean
  }
  const update: ServerUpdate = {}
  if (body.name !== undefined) update.name = body.name
  if (body.url !== undefined) update.url = body.url.replace(/\/$/, '')
  if (body.admin_token !== undefined) update.admin_token = body.admin_token
  if (body.active !== undefined) update.active = body.active

  const { data, error: dbError } = await supabase
    .from('servers')
    .update(update)
    .eq('id', id)
    .select('id, name, url, active, created_at')
    .single()

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const { error, supabase } = await requireAuth()
  if (error) return error

  const { id } = await params

  // Check if any active instances reference this server
  const { count } = await supabase
    .from('instances')
    .select('*', { count: 'exact', head: true })
    .eq('server_id', id)
    .eq('active', true)

  if (count && count > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${count} active instance(s) use this server. Reassign or deactivate them first.` },
      { status: 409 }
    )
  }

  const { error: dbError } = await supabase.from('servers').delete().eq('id', id)

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
