import type { UazapiInstance, ConnectRequest, ConnectResponse, ConnectResponseRaw, StatusResponseRaw, ProxyCity, GlobalWebhookConfig, GlobalWebhookResponse } from './types'

interface RequestOptions extends Omit<RequestInit, 'headers'> {
  token?: string
  adminToken?: string
  headers?: Record<string, string>
}

function createUazapiClient(baseUrl: string, defaultAdminToken: string) {
  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { token, adminToken, ...fetchOptions } = options

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    if (token) {
      headers['token'] = token
    } else {
      headers['admintoken'] = adminToken ?? defaultAdminToken
    }

    const res = await fetch(`${baseUrl}${path}`, {
      ...fetchOptions,
      headers,
    })

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

    // Webhook configuration
    setWebhook: (token: string, url: string, events: string[]) =>
      request<void>('/webhook', {
        method: 'POST',
        token,
        body: JSON.stringify({ url, events }),
      }),

    // Send text message — used internally for WhatsApp disconnect alerts
    sendText: (token: string, to: string, text: string) =>
      request<void>('/send/text', {
        method: 'POST',
        token,
        body: JSON.stringify({ number: to, text }),
      }),

    // ─── Global Webhook — uses admintoken, no instance token ──────────────

    /** GET /globalwebhook — read current global webhook config */
    getGlobalWebhook: () =>
      request<GlobalWebhookResponse>('/globalwebhook'),

    /** POST /globalwebhook — create or update the global webhook */
    setGlobalWebhook: (config: GlobalWebhookConfig) =>
      request<GlobalWebhookResponse>('/globalwebhook', {
        method: 'POST',
        body: JSON.stringify(config),
      }),
  }
}

// Default client using env vars (fallback for server-side usage without DB lookup)
const defaultBaseUrl = process.env.UAZAPI_BASE_URL ?? 'https://free.uazapi.com'
const defaultAdminToken = process.env.UAZAPI_ADMIN_TOKEN ?? ''

export const uazapi = createUazapiClient(defaultBaseUrl, defaultAdminToken)

// Factory: create a client bound to a specific server's URL and admin token
export function createUazapi(serverUrl: string, adminToken: string) {
  return createUazapiClient(serverUrl, adminToken)
}

export type UazapiClient = ReturnType<typeof createUazapiClient>
