import type {
  UazapiInstance, ConnectRequest, ConnectResponse, ConnectResponseRaw, StatusResponseRaw,
  ProxyCity, GlobalWebhookConfig, GlobalWebhookResponse,
  WaMessagesLimits, WebhookDeliveryError, InstanceWebhookConfig, InstanceProxy, AsyncQueueStatus,
} from './types'

/** Timeout padrão de qualquer chamada ao uazapiGO. */
const DEFAULT_TIMEOUT_MS = 15_000

/** Normaliza resposta que pode vir como objeto único ou array. */
function toArray<T>(raw: T | T[] | null | undefined): T[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object' && Object.keys(raw).length > 0) return [raw]
  return []
}

interface RequestOptions extends Omit<RequestInit, 'headers'> {
  token?: string
  adminToken?: string
  headers?: Record<string, string>
  /** Sobrescreve o timeout padrão (ms). */
  timeoutMs?: number
}

function createUazapiClient(baseUrl: string, defaultAdminToken: string) {
  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { token, adminToken, timeoutMs, ...fetchOptions } = options

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    if (token) {
      headers['token'] = token
    } else {
      headers['admintoken'] = adminToken ?? defaultAdminToken
    }

    // Sem timeout, um servidor uazapiGO lento trava a request inteira e pode
    // estourar o limite de CPU/tempo do Cloudflare Worker.
    let res: Response
    try {
      res = await fetch(`${baseUrl}${path}`, {
        ...fetchOptions,
        headers,
        signal: AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS),
      })
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new Error(`uazapiGO timeout após ${timeoutMs ?? DEFAULT_TIMEOUT_MS}ms em ${path}`)
      }
      throw err
    }

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`uazapiGO ${res.status}: ${err}`)
    }

    const text = await res.text()
    if (!text) return {} as T
    return JSON.parse(text) as T
  }

  return {
    // Admin endpoints
    createInstance: (name: string) =>
      request<UazapiInstance>('/instance/create', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),

    listInstances: () =>
      request<UazapiInstance[]>('/instance/all'),

    // Instance-level endpoints
    getStatus: async (token: string): Promise<UazapiInstance> => {
      // GET /instance/status returns { instance: UazapiInstance, status: { connected, loggedIn, jid } }
      // qrcode and paircode are inside `instance`, NOT at the top level.
      const raw = await request<StatusResponseRaw>('/instance/status', { token })
      // Extract the inner instance; fall back gracefully if API shape changes
      if (raw && typeof raw === 'object' && 'instance' in raw && raw.instance) {
        return raw.instance
      }
      return raw as unknown as UazapiInstance
    },

    connect: async (token: string, payload: ConnectRequest = {}): Promise<ConnectResponse> => {
      // uazapiGO returns: { connected, instance: { status, qrcode, paircode, ... }, response, ... }
      const raw = await request<ConnectResponseRaw>('/instance/connect', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      })

      // Normalise to a flat ConnectResponse — handle both single object and legacy array
      const item: ConnectResponseRaw = Array.isArray(raw) ? raw[0] : raw
      const inst = item?.instance

      const status: ConnectResponse['status'] =
        item?.connected || inst?.status === 'connected' ? 'connected' : (inst?.status ?? 'connecting')

      return {
        status,
        qrcode:   inst?.qrcode   || undefined,
        paircode: inst?.paircode || undefined,
      }
    },

    disconnect: (token: string) =>
      request<void>('/instance/disconnect', { method: 'POST', token }),

    resetInstance: (token: string) =>
      request<void>('/instance/reset', { method: 'POST', token }),

    deleteInstance: (token: string) =>
      request<void>('/instance', { method: 'DELETE', token }),

    updateName: (token: string, name: string) =>
      request<UazapiInstance>('/instance/updateInstanceName', {
        method: 'POST',
        token,
        body: JSON.stringify({ name }),
      }),

    // Proxy city listing (uses admintoken)
    getCities: (country = 'br') =>
      request<ProxyCity[]>(`/proxy-managed/cities?country=${country}`),

    // ⚠️ NUNCA adicionar um método de escrita em POST /webhook (por instância).
    // Os webhooks individuais pertencem aos agentes de IA no n8n — cada instância
    // tem uma URL única cadastrada lá. Sobrescrevê-los derruba o agente do cliente.
    // O painel só usa o webhook GLOBAL (abaixo) para eventos `connection`.

    // Send text message — used internally for WhatsApp disconnect alerts
    sendText: (token: string, to: string, text: string) =>
      request<void>('/send/text', {
        method: 'POST',
        token,
        body: JSON.stringify({ number: to, text }),
      }),

    // ─── Diagnóstico (somente leitura) ────────────────────────────────────

    /**
     * GET /instance/wa_messages_limits — cota de novas conversas do WhatsApp.
     * Detecta o bloqueio (provider_code 463) que faz o agente parar de iniciar
     * conversas SEM que a instância desconecte. Exige sessão conectada.
     */
    getMessagesLimits: (token: string) =>
      request<WaMessagesLimits>('/instance/wa_messages_limits', { token }),

    /**
     * GET /webhook — configuração de webhook DA INSTÂNCIA.
     * ⚠️ APENAS LEITURA: esses webhooks pertencem aos agentes de IA no n8n.
     * Serve para exibir/diagnosticar, nunca para escrever.
     */
    getInstanceWebhooks: async (token: string): Promise<InstanceWebhookConfig[]> =>
      toArray(await request<InstanceWebhookConfig | InstanceWebhookConfig[]>('/webhook', { token })),

    /** GET /webhook/errors — últimos erros de entrega do webhook do agente. */
    getInstanceWebhookErrors: async (token: string): Promise<WebhookDeliveryError[]> =>
      toArray(await request<WebhookDeliveryError | WebhookDeliveryError[]>('/webhook/errors', { token })),

    /** GET /globalwebhook/errors — erros de entrega do webhook que alimenta ESTE painel. */
    getGlobalWebhookErrors: async (): Promise<WebhookDeliveryError[]> =>
      toArray(await request<WebhookDeliveryError | WebhookDeliveryError[]>('/globalwebhook/errors')),

    /** GET /instance/proxy — compara intenção (`mode`) com realidade (`effective_mode`). */
    getProxy: (token: string) =>
      request<InstanceProxy>('/instance/proxy', { token }),

    /**
     * POST /instance/proxy — troca/rotaciona o proxy.
     * `rotate_now: true` com `mode: 'internal'` troca o IP na hora — é a ação de
     * recuperação mais barata antes de pedir reconexão ao cliente.
     * 200 significa apenas "gravado": confirmar depois via getProxy().
     */
    setProxy: (
      token: string,
      payload: { mode: 'custom' | 'internal' | 'none'; proxy_url?: string; proxy_fallback?: string; confirm_no_proxy?: boolean; rotate_now?: boolean }
    ) =>
      request<{ details?: string; proxy?: InstanceProxy; restart_requested?: boolean; rotated?: boolean }>(
        '/instance/proxy',
        { method: 'POST', token, body: JSON.stringify(payload) }
      ),

    /** GET /message/async — estado da fila de envio (detecta agente travado). */
    getAsyncQueue: (token: string) =>
      request<AsyncQueueStatus>('/message/async', { token }),

    // ─── Global Webhook — uses admintoken, no instance token ──────────────

    /**
     * GET /globalwebhook — read current global webhook config.
     * Older uazapiGO builds return a single object; newer builds return an
     * array of webhooks. Always normalised to an array here.
     */
    getGlobalWebhook: async (): Promise<GlobalWebhookResponse[]> =>
      toArray(await request<GlobalWebhookResponse | GlobalWebhookResponse[]>('/globalwebhook')),

    /** POST /globalwebhook — create or update the global webhook (normalised to array) */
    setGlobalWebhook: async (config: GlobalWebhookConfig): Promise<GlobalWebhookResponse[]> =>
      toArray(await request<GlobalWebhookResponse | GlobalWebhookResponse[]>('/globalwebhook', {
        method: 'POST',
        body: JSON.stringify(config),
      })),
  }
}

// Default client using env vars (fallback for server-side usage without DB lookup)
// `.trim()` porque um secret gravado via `echo` carrega uma quebra de linha no
// fim — isso quebra a URL base e torna o header `admintoken` invalido.
const defaultBaseUrl = (process.env.UAZAPI_BASE_URL ?? 'https://free.uazapi.com').trim().replace(/\/$/, '')
const defaultAdminToken = (process.env.UAZAPI_ADMIN_TOKEN ?? '').trim()

export const uazapi = createUazapiClient(defaultBaseUrl, defaultAdminToken)

// Factory: create a client bound to a specific server's URL and admin token
export function createUazapi(serverUrl: string, adminToken: string) {
  return createUazapiClient(serverUrl.trim().replace(/\/$/, ''), adminToken.trim())
}

export type UazapiClient = ReturnType<typeof createUazapiClient>
