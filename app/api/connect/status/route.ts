import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getInstanceClient } from '@/lib/api-helpers'
import { isInstanceStatus, type InstanceStatus } from '@/lib/uazapi/types'
import { withMissingColumnFallback } from '@/lib/db-resilient'

// Público — consultado em polling pelos componentes do cliente.
//
// A leitura primária é do banco (barata), mas o banco só é confiável enquanto o
// webhook está entregando. Quando ele falha, o cliente escaneia o QR, conecta de
// verdade, e esta rota seguia respondendo "disconnected" para sempre: a tela
// nunca saía de "aguardando", o cliente reescaneava e abria chamado.
//
// Por isso, quando o registro está velho ou ainda não conectou, confirmamos o
// status direto no uazapiGO e gravamos o resultado.

/** Acima disso o dado do banco é considerado velho e vale confirmar na API. */
const STALE_AFTER_MS = 20_000

export async function GET(request: NextRequest): Promise<NextResponse> {
  const instanceId = request.nextUrl.searchParams.get('instanceId')

  if (!instanceId || instanceId.trim() === '') {
    return NextResponse.json({ error: 'instanceId query param is required' }, { status: 400 })
  }

  const supabase = await createServiceClient()

  const { data: instance, error: dbError } = await supabase
    .from('instances')
    .select('id, status, phone_connected, last_seen_at, updated_at')
    .eq('id', instanceId)
    .eq('active', true)
    .maybeSingle()

  if (dbError) {
    console.error('[connect/status] DB error:', dbError.message)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 })
  }

  const dbStatus = instance.status as InstanceStatus

  // Confirma na API quando o dado pode estar defasado. Enquanto a instância não
  // está conectada, o cliente está olhando a tela agora — é exatamente o momento
  // em que um status errado custa caro, então sempre confirmamos.
  const lastSeen = instance.last_seen_at ?? instance.updated_at
  const ageMs    = lastSeen ? Date.now() - new Date(lastSeen).getTime() : Infinity
  const shouldVerify = dbStatus !== 'connected' || ageMs > STALE_AFTER_MS

  if (!shouldVerify) {
    return NextResponse.json({
      status: dbStatus,
      ...(instance.phone_connected ? { phone: instance.phone_connected } : {}),
      source: 'db',
    })
  }

  try {
    const resolved = await getInstanceClient(instanceId)
    if (!resolved) throw new Error('instância não resolvida')

    const remote = await resolved.client.getStatus(resolved.uazapiToken)

    if (!isInstanceStatus(remote?.status)) {
      throw new Error(`status inesperado: ${String(remote?.status)}`)
    }

    const liveStatus = remote.status
    const livePhone  = remote.owner ?? remote.phone ?? null
    const now        = new Date().toISOString()

    // Grava o que a API disse para que dashboard e Realtime também acompanhem,
    // mesmo com o webhook fora do ar.
    if (liveStatus !== dbStatus || livePhone !== instance.phone_connected) {
      const payload: {
        status: InstanceStatus
        last_seen_at: string
        phone_connected?: string | null
        last_disconnected_at?: string
      } = { status: liveStatus, last_seen_at: now }

      if (liveStatus === 'connected') {
        payload.phone_connected = livePhone
      } else if (liveStatus === 'disconnected') {
        payload.phone_connected = null
        payload.last_disconnected_at = now
      }

      const { error: updateError } = await withMissingColumnFallback(
        payload,
        (p) => supabase.from('instances').update(p).eq('id', instanceId),
        'status no portal do cliente'
      )

      if (updateError) console.error('[connect/status] update falhou:', updateError.message)

      // Conectou: o link de reconexão cumpriu o papel e é queimado agora.
      // Antes `used_at` nunca era gravado e o link seguia válido as 24h inteiras.
      if (liveStatus === 'connected') {
        await supabase
          .from('reconnect_tokens')
          .update({ used_at: now })
          .eq('instance_id', instanceId)
          .is('used_at', null)
      }
    } else {
      await withMissingColumnFallback(
        { last_seen_at: now },
        (p) => supabase.from('instances').update(p).eq('id', instanceId),
        'last_seen_at no portal do cliente'
      )
    }

    return NextResponse.json({
      status: liveStatus,
      ...(liveStatus === 'connected' && livePhone ? { phone: livePhone } : {}),
      source: 'uazapi',
    })
  } catch (err) {
    // A API pode estar instável — devolver o último status conhecido é melhor
    // que quebrar a tela do cliente.
    console.warn(
      '[connect/status] confirmação na API falhou, usando status do banco:',
      err instanceof Error ? err.message : String(err)
    )
    return NextResponse.json({
      status: dbStatus,
      ...(instance.phone_connected ? { phone: instance.phone_connected } : {}),
      source: 'db-fallback',
    })
  }
}
