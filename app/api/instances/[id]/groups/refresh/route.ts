import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/api-helpers'
import { atualizarCacheDeGrupos } from '@/lib/groups/cache'
import { lerErroDaUazapi } from '@/lib/groups/errors'
import { tabelaNaoExiste } from '@/lib/groups/install'

/**
 * POST /api/instances/[id]/groups/refresh — recarrega a lista de grupos.
 *
 * Corpo opcional: `{ force: true }` pede à uazapiGO que recarregue a lista do
 * próprio WhatsApp, em vez de devolver a cópia dela. É mais lento; o botão da
 * tela usa só quando a pessoa pede explicitamente.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const { id } = await params

  let force = false
  try {
    const body = (await request.json()) as { force?: unknown }
    force = body?.force === true
  } catch {
    // corpo vazio = sem force
  }

  try {
    const resultado = await atualizarCacheDeGrupos(id, { force })
    return NextResponse.json({ refresh: resultado })
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err)

    // Migration 015 não aplicada: avisa o que fazer em vez de um 500 mudo.
    if (tabelaNaoExiste({ message: mensagem }) || /group_cache/.test(mensagem) && /schema cache/.test(mensagem)) {
      return NextResponse.json(
        { error: 'A migration 015 ainda não foi aplicada no banco.', migracaoPendente: true },
        { status: 503 }
      )
    }

    if (mensagem === 'Instância não encontrada.') {
      return NextResponse.json({ error: mensagem }, { status: 404 })
    }

    const erro = lerErroDaUazapi(err)
    console.error('[groups/refresh] falha:', erro.corpo)

    return NextResponse.json(
      {
        error: erro.timeout
          ? 'A uazapiGO demorou demais para listar os grupos. Tente de novo em instantes.'
          : `Não foi possível carregar os grupos: ${erro.mensagem}`,
      },
      { status: 502 }
    )
  }
}
