import { createServiceClient } from '@/lib/supabase/server'
import { getInstanceClient } from '@/lib/api-helpers'
import type { WaMessagesLimits } from '@/lib/uazapi/types'
import { avaliarLimites, type ResultadoDoPrevoo } from './preflight-regras'

/**
 * Pré-voo: o número pode mandar mensagem agora?
 *
 * Roda antes de toda campanha e fica registrado nela. A escolha de produto foi
 * "trava com aviso" — ou seja, o bloqueio é real, não só um alerta na tela.
 */

/** Consulta o banco e a uazapiGO e devolve a decisão. */
export async function executarPrevoo(instanceId: string): Promise<ResultadoDoPrevoo | null> {
  const db = await createServiceClient()

  const { data: instancia } = await db
    .from('instances')
    .select('status')
    .eq('id', instanceId)
    .maybeSingle()

  if (!instancia) return null

  const conectada = instancia.status === 'connected'

  // Sem sessão a consulta de limites nem funciona; poupa a chamada.
  if (!conectada) {
    return { conectada, limites: null, ...avaliarLimites(null, false) }
  }

  let limites: WaMessagesLimits | null = null
  try {
    const resolvida = await getInstanceClient(instanceId)
    if (resolvida) {
      limites = await resolvida.client.getMessagesLimits(resolvida.uazapiToken)
    }
  } catch (err) {
    console.warn(
      '[groups/preflight] falha ao consultar wa_messages_limits:',
      err instanceof Error ? err.message : String(err)
    )
  }

  return { conectada, limites, ...avaliarLimites(limites, true) }
}

export { avaliarLimites } from './preflight-regras'
export type { Bloqueio, ResultadoDoPrevoo, TipoDeBloqueio } from './preflight-regras'
