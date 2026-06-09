export type InstanceStatus = 'connected' | 'disconnected' | 'connecting'

export type BrowserType = 'auto' | 'safari' | 'firefox' | 'edge' | 'chrome'

export interface UazapiInstance {
  /** Internal identifier returned by uazapiGO (may differ from the auth token). */
  id?: string
  /**
   * Instance authentication token — sent as `token` header in instance-level requests.
   * This is the value that must be stored in `instances.uazapi_token`.
   * uazapiGO returns it as `token` in /instance/all and /instance/create responses.
   */
  token?: string
  name: string
  status: InstanceStatus

  // Connect response fields
  qrcode?: string
  paircode?: string   // uazapiGO uses "paircode" in list; "pairingCode" in connect response

  /**
   * Connected WhatsApp number (E.164-ish).
   * Returned as "owner" in /instance/all — e.g. "5521965560026".
   */
  owner?: string
  /** @deprecated alias — some versions return "phone" instead of "owner" */
  phone?: string

  /** Profile display name — returned as "profileName" in /instance/all */
  profileName?: string
  /** Profile picture URL — returned as "profilePicUrl" in /instance/all */
  profilePicUrl?: string

  /**
   * Last disconnect timestamp — returned as "lastDisconnect" in /instance/all.
   * Format: "2026-04-30 16:43:29.235Z"
   */
  lastDisconnect?: string
  /** @deprecated alias — older field name */
  lastDisconnection?: string

  /** ISO timestamp when the instance was created */
  created?: string
  createdAt?: string

  // Extra fields returned by uazapiGO (stored for reference only)
  profileInfo?: {
    name?: string
    picture?: string
  }
}

export interface ConnectRequest {
  phone?: string               // pairing code mode when set; QR mode when omitted
  browser?: BrowserType        // browser profile used in auth cycle
  systemName?: string          // label shown on phone "Linked Devices" list
  proxy_managed_country?: string  // 'br' (only option currently)
  proxy_managed_state?: string    // e.g. 'sp'
  proxy_managed_city?: string     // value from GET /proxy-managed/cities
}

/**
 * Resposta normalizada do /instance/connect.
 * O cliente faz o parse do array bruto e extrai esses campos.
 */
export interface ConnectResponse {
  status: InstanceStatus
  /** QR code — base64 string (sem prefixo data:image). Disponível quando status = "connecting" (modo QR). */
  qrcode?: string
  /** Código de pareamento (ex: "5Y84-QVCP"). Disponível quando status = "connecting" (modo pairing). */
  paircode?: string
  /** @deprecated alias mantido para compatibilidade */
  pairingCode?: string
}

/**
 * Formato BRUTO retornado por /instance/connect — objeto único.
 * { connected: false, instance: { status, qrcode, paircode, ... }, response: "Connecting" }
 */
export interface ConnectResponseRaw {
  connected: boolean
  instance: UazapiInstance
  jid: string | null
  loggedIn: boolean
  response: string
  status: {
    connected: boolean
    jid: string | null
    loggedIn: boolean
  }
}

/**
 * Formato BRUTO retornado por GET /instance/status.
 * { instance: { status, qrcode, paircode, ... }, status: { connected, loggedIn, jid } }
 */
export interface StatusResponseRaw {
  instance: UazapiInstance
  status: {
    connected: boolean
    loggedIn: boolean
    jid: unknown
  }
}

export interface ProxyCity {
  label: string    // human-readable city name, e.g. "Campinas"
  value: string    // send this in proxy_managed_city, e.g. "campinas"
  state?: string   // send this in proxy_managed_state when present, e.g. "sp"
}

/**
 * Actual payload format sent by uazapiGO global webhook (confirmed via webhook.cool).
 * Note: "event" vs "EventType" — global webhook uses EventType (capital letters).
 */
export interface WebhookConnectionEvent {
  // Global webhook format (primary)
  EventType?: 'connection'
  BaseUrl?: string
  token?: string        // instance auth token (top-level in global format)
  owner?: string        // connected phone number
  instanceName?: string
  type?: string         // e.g. "LoggedOut"
  instance?: {
    name?: string
    status?: InstanceStatus
    qrcode?: string
    lastDisconnect?: string
    lastDisconnectReason?: string
  }
  // Legacy per-instance format (fallback)
  event?: 'connection'
  data?: {
    status?: InstanceStatus
    phone?: string
    reason?: string
  }
}

export interface UazapiError {
  error: string
  message: string
  statusCode: number
}

// ─── Webhook Global (/globalwebhook — admintoken) ───────────────────────────

export type GlobalWebhookEvent =
  | 'connection'
  | 'history'
  | 'messages'
  | 'messages_update'
  | 'newsletter_messages'
  | 'call'
  | 'contacts'
  | 'presence'
  | 'groups'
  | 'labels'
  | 'chats'
  | 'chat_labels'
  | 'blocks'
  | 'sender'

export type GlobalWebhookExcludeFilter =
  | 'wasSentByApi'
  | 'wasNotSentByApi'
  | 'fromMeYes'
  | 'fromMeNo'
  | 'isGroupYes'
  | 'isGroupNo'

export interface GlobalWebhookConfig {
  url: string
  enabled?: boolean           // must be true to activate — defaults to false on the server
  events: GlobalWebhookEvent[]
  excludeMessages?: GlobalWebhookExcludeFilter[]
  addUrlEvents?: boolean
  addUrlTypesMessages?: boolean
}

/** Shape returned by GET /globalwebhook */
export interface GlobalWebhookResponse {
  id?: string
  enabled?: boolean
  url?: string
  events?: GlobalWebhookEvent[]
  excludeMessages?: GlobalWebhookExcludeFilter[]
  addUrlEvents?: boolean
  addUrlTypesMessages?: boolean
}
