import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * PATCH  /api/groups/links/[id] — `{ ativo: boolean }`: liga ou desliga o link.
 * DELETE /api/groups/links/[id] — apaga o link e a contagem dele.
 *
 * Desativar é o que se faz com um convite que vazou: o link para de resolver na
 * hora, e a contagem fica guardada. Apagar libera o endereço — quem ainda tiver
 * o link antigo passa a cair em "não encontrado".
 */

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const { id } = await params

  let ativo: unknown
  try {
    ativo = ((await request.json()) as { ativo?: unknown }).ativo
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }
  if (typeof ativo !== 'boolean') return NextResponse.json({ error: 'Informe se o link fica ativo.' }, { status: 400 })

  const db = await createServiceClient()
  const { data, error } = await db.from('short_links').update({ active: ativo }).eq('id', id).select('id')

  if (error) {
    console.error('[groups/links] falha ao atualizar:', error.message)
    return NextResponse.json({ error: 'Não foi possível atualizar o link.' }, { status: 500 })
  }
  if (!data || data.length === 0) return NextResponse.json({ error: 'Link não encontrado.' }, { status: 404 })

  return NextResponse.json({ ok: true, ativo })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const { id } = await params

  const db = await createServiceClient()
  const { data, error } = await db.from('short_links').delete().eq('id', id).select('id')

  if (error) {
    console.error('[groups/links] falha ao apagar:', error.message)
    return NextResponse.json({ error: 'Não foi possível apagar o link.' }, { status: 500 })
  }
  if (!data || data.length === 0) return NextResponse.json({ error: 'Link não encontrado.' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
