import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/api-helpers'
import { executarPrevoo } from '@/lib/groups/preflight'

/**
 * GET /api/instances/[id]/groups/preflight — o número pode enviar agora?
 *
 * A tela consulta ao abrir e antes de confirmar um disparo. A decisão real é
 * refeita no servidor em `dispatch/start`: esta rota só informa.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const { id } = await params

  const previo = await executarPrevoo(id)
  if (!previo) {
    return NextResponse.json({ error: 'Instância não encontrada.' }, { status: 404 })
  }

  return NextResponse.json({ preflight: previo })
}
