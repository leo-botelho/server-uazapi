export type InstanceStatus = 'connected' | 'disconnected' | 'connecting'

export type BrowserType = 'auto' | 'safari' | 'firefox' | 'edge' | 'chrome'

export interface UazapiInstance {
  id: string
  name: string
  status: InstanceStatus
  qrcode?: string
  pairingCode?: string
  phone?: string
  profileInfo?: {
    name?: string
    picture?: string
  }
  lastDisconnection?: string
  createdAt: string
}

export interface ConnectRequest {
  phone?: string               // pairing code mode when set; QR mode when omitted
  browser?: BrowserType        // browser profile used in auth cycle
  systemName?: string          // label shown on phone "Linked Devices" list
  proxy_managed_country?: string  // 'br' (only option currently)
  proxy_managed_state?: string    // e.g. 'sp'
  proxy_managed_city?: string     // value from GET /proxy-managed/cities
}

export interface ConnectResponse {
  status: InstanceStatus
  qrcode?: string
  pairingCode?: string
}

export interface ProxyCity {
  label: string    // human-readable city name, e.g. "Campinas"
  value: string    // send this in proxy_managed_city, e.g. "campinas"
  state?: string   // send this in proxy_managed_state when present, e.g. "sp"
}

export interface WebhookConnectionEvent {
  event: 'connection'
  instance: string  // instance token
  data: {
    status: InstanceStatus
    phone?: string
    reason?: string
  }
}

export interface UazapiError {
  error: string
  message: string
  statusCode: number
}
