import type { UazapiInstance, ConnectRequest, ConnectResponse, ProxyCity } from './types'

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
    getStatus: (token: string) =>
      request<UazapiInstance>('/instance/status', { token }),

    connect: (token: string, payload: ConnectRequest = {}) =>
      request<ConnectResponse>('/instance/connect', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      }),

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
