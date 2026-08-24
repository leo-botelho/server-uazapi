import { NextResponse } from 'next/server'
import { requireAuth, getInstanceClient } from '@/lib/api-helpers'
import type {
  WaMessagesLimits, WebhookDeliveryError, InstanceWebhookConfig,
  InstanceProxy, AsyncQueueStatus,
} from '@/lib/uazapi/types'

/**
 * GET /api/instances/[id]/health — diagnóstico completo da instância.
 *
 * Junta num único payload os sinais que revelam problema ANTES do cliente
 * reclamar. Todas as chamadas são SOMENTE LEITURA — em especial `GET /webhook`,
 * que apenas exibe a configuração do agente de IA no n8n e jamais a altera.
 *
 * Cada bloco é independente: se um endpoint falhar (ou não existir na versão do
 * servidor), os outros continuam retornando. Por isso o resultado vem como
 * `{ data } | { error }` por seção, em vez de derrubar a resposta inteira.
 */

export interface HealthSection<T> {
  data: T | null
  error: string | null
}

async function section<T>(fn: () => Promise<T>): Promise<HealthSection<T>> {
  try {
    return { data: await fn(), error: null }
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const { id } = await params

  const resolved = await getInstanceClient(id)
  if (!resolved) {
    return NextResponse.json({ error: 'Instância não encontrada' }, { status: 404 })
  }

  const { client, uazapiToken } = resolved

  // Em paralelo: o diagnóstico inteiro custa o tempo da chamada mais lenta.
  const [limits, webhooks, webhookErrors, proxy, queue] = await Promise.all([
    section<WaMessagesLimits>(() => client.getMessagesLimits(uazapiToken)),
    section<InstanceWebhookConfig[]>(() => client.getInstanceWebhooks(uazapiToken)),
    section<WebhookDeliveryError[]>(() => client.getInstanceWebhookErrors(uazapiToken)),
    section<InstanceProxy>(() => client.getProxy(uazapiToken)),
    section<AsyncQueueStatus>(() => client.getAsyncQueue(uazapiToken)),
  ])

  return NextResponse.json({ limits, webhooks, webhookErrors, proxy, queue })
}
