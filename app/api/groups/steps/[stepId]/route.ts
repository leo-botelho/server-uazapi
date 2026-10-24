import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { editarTextoDoPasso } from '@/lib/groups/agenda'
import { funcaoNaoExiste } from '@/lib/groups/scheduler-regras'
import type { Json } from '@/types/database'

/**
 * PATCH /api/groups/steps/[stepId] — troca o TEXTO de um passo agendado. Corpo: `{ texto }`.
 *
 * Vale para mensagem de texto, nome e descrição do grupo (mídia, botões e foto: cancela e cria de
 * novo). O texto passa pelas mesmas regras da criação, e a troca é ATÔMICA no banco: só grava se
 * nenhuma execução do passo saiu de `scheduled` (migration 020). Sem isso, uma execução que
 * abrisse no meio da edição mandaria o texto velho para uns grupos e o novo para outros.
 *
 * O texto vale para TODAS as execuções do passo (é o conteúdo do passo, não de uma data).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ stepId: string }> }
): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const { stepId } = await params

  let texto: unknown
  try {
    texto = ((await request.json()) as { texto?: unknown }).texto
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  const db = await createServiceClient()

  const { data: passo } = await db
    .from('group_task_steps')
    .select('id, kind, payload')
    .eq('id', stepId)
    .maybeSingle()

  if (!passo) return NextResponse.json({ error: 'Passo não encontrado.' }, { status: 404 })

  const novo = editarTextoDoPasso(passo.kind, passo.payload, texto)
  if (!novo.ok) return NextResponse.json({ error: novo.erro }, { status: 400 })

  const r = await db.rpc('update_group_step_payload', { p_step: stepId, p_payload: novo.payload as unknown as Json })

  if (r.error) {
    if (funcaoNaoExiste(r.error)) {
      return NextResponse.json(
        { error: 'Para editar um agendamento, aplique a migration 020_edit_scheduled_step.sql no Supabase.', migracaoPendente: true },
        { status: 503 }
      )
    }
    console.error('[groups/steps] falha ao editar:', r.error.message)
    return NextResponse.json({ error: 'Não foi possível editar o passo.' }, { status: 500 })
  }

  if (r.data !== true) {
    return NextResponse.json(
      { error: 'Este passo já começou a rodar (ou o agendamento terminou): não dá mais para editar o texto.' },
      { status: 409 }
    )
  }

  return NextResponse.json({ ok: true })
}
