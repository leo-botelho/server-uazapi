import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { listarGruposEmCache } from '@/lib/groups/cache'
import { CABECALHO_DE_GRUPOS, diaParaArquivo, linhasDeGrupos, montarCsv } from '@/lib/groups/csv'

/**
 * GET /api/instances/[id]/groups/export — a lista de grupos da instância em CSV.
 *
 * Sai do CACHE (já paginado a 1000 por consulta), sem chamar a uazapiGO: é só metadado do
 * grupo, nada de participante. A lista de PARTICIPANTES não passa por aqui: é dado pessoal,
 * não fica guardada, e a tela a monta chamando `groups/info` grupo a grupo — um pedido por
 * grupo, cada um com o seu orçamento de CPU no plano Free.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  const { id: instanceId } = await params

  const db = await createServiceClient()
  const { data: instancia } = await db
    .from('instances')
    .select('id, name')
    .eq('id', instanceId)
    .eq('active', true)
    .maybeSingle()

  if (!instancia) return NextResponse.json({ error: 'Instância não encontrada.' }, { status: 404 })

  let grupos
  try {
    grupos = await listarGruposEmCache(instanceId)
  } catch (err) {
    console.error('[groups/export] falha ao ler o cache:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erro ao consultar o banco.' }, { status: 500 })
  }

  if (grupos.length === 0) {
    return NextResponse.json(
      { error: 'A lista de grupos está vazia. Clique em “Atualizar lista” e tente de novo.' },
      { status: 409 }
    )
  }

  console.log(`[groups/export] ${user.id} exportou ${grupos.length} grupos da instância ${instanceId}`)

  const csv = montarCsv(CABECALHO_DE_GRUPOS, linhasDeGrupos(grupos))

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="grupos-${diaParaArquivo()}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
