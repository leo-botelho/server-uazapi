import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getInstanceClient } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * POST /api/instances/[id]/purge — apaga o cadastro de vez.
 *
 * Diferente de `DELETE /api/instances/[id]`, que desativa (soft-delete) e tenta
 * excluir no uazapiGO. Aqui a instancia JA foi excluida la: o que sobrou e um
 * cadastro orfao no painel.
 *
 * ⚠️ Apagar a linha leva junto o historico: `webhook_events`,
 * `notifications_log` e `reconnect_tokens` tem ON DELETE CASCADE. Por isso:
 *  - confere na hora se a instancia realmente sumiu do uazapiGO;
 *  - se ela ainda existir la, RECUSA (a nao ser que o operador mande `force`),
 *    porque apagar o cadastro deixaria a instancia viva e cobrando, invisivel.
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

  const supabase = await createServiceClient()

  const { data: instance, error: findError } = await supabase
    .from('instances')
    .select('id, name, uazapi_token')
    .eq('id', id)
    .maybeSingle()

  if (findError) {
    console.error('[instances/[id]/purge] erro ao buscar:', findError.message)
    return NextResponse.json({ error: 'Erro ao consultar o banco' }, { status: 500 })
  }
  if (!instance) {
    return NextResponse.json({ error: 'Instância não encontrada' }, { status: 404 })
  }

  // ── Confere no uazapiGO ───────────────────────────────────────────────────
  let aindaExiste: boolean | null = null   // null = não deu para confirmar
  let checkError: string | null = null

  try {
    const resolved = await getInstanceClient(id)
    if (!resolved) throw new Error('Servidor da instância não resolvido')

    const remotas = await resolved.client.listInstances()
    aindaExiste = (remotas ?? []).some(
      (r) => (r.token ?? r.id) === instance.uazapi_token || r.name === instance.name
    )
  } catch (err) {
    checkError = err instanceof Error ? err.message : String(err)
    console.warn('[instances/[id]/purge] não foi possível confirmar no uazapiGO:', checkError)
  }

  if (aindaExiste === true && !force) {
    return NextResponse.json(
      {
        error: `"${instance.name}" ainda existe no uazapiGO. Exclua primeiro por lá, ` +
               'senão ela continuaria ativa (e cobrando) sem aparecer no painel.',
        stillExists: true,
      },
      { status: 409 }
    )
  }

  if (aindaExiste === null && !force) {
    return NextResponse.json(
      {
        error: `Não foi possível confirmar no uazapiGO se "${instance.name}" ainda existe ` +
               `(${checkError ?? 'motivo desconhecido'}). Tente de novo em instantes.`,
        unconfirmed: true,
      },
      { status: 503 }
    )
  }

  // ── Apaga de vez ──────────────────────────────────────────────────────────
  const { error: deleteError } = await supabase
    .from('instances')
    .delete()
    .eq('id', id)

  if (deleteError) {
    console.error('[instances/[id]/purge] falha ao apagar:', deleteError.message)
    return NextResponse.json({ error: `Falha ao apagar o cadastro: ${deleteError.message}` }, { status: 500 })
  }

  console.warn(
    `[instances/[id]/purge] cadastro de "${instance.name}" apagado do banco` +
    `${force ? ' (force)' : ''} — histórico de eventos e alertas foi junto.`
  )

  return NextResponse.json({ success: true, name: instance.name, forced: force })
}
