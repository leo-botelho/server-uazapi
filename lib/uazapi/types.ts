/**
 * Estados possíveis de uma instância, conforme a spec uazapiGO v2.1:
 * - `disconnected`: desconectado do WhatsApp
 * - `connecting`:   em processo de conexão (aguardando QR / pairing code)
 * - `connected`:    conectado e autenticado
 * - `hibernated`:   sessão pausada, com credenciais preservadas para reconexão
 *
 * ⚠️ `hibernated` PRECISA existir aqui e no CHECK da tabela `instances`
 * (migration 009). Sem ele o UPDATE é rejeitado pelo banco e o painel mostra
 * status desatualizado — a instância aparece "conectada" enquanto está parada.
 */
export type InstanceStatus = 'connected' | 'disconnected' | 'connecting' | 'hibernated'

/** Status em que a instância NÃO está atendendo — usado para alertas. */
export const OFFLINE_STATUSES: readonly InstanceStatus[] = ['disconnected', 'hibernated']

export function isOffline(status: InstanceStatus | null | undefined): boolean {
  return status === 'disconnected' || status === 'hibernated'
}

/** Type guard — valida um status vindo de payload externo (webhook/API). */
export function isInstanceStatus(value: unknown): value is InstanceStatus {
  return value === 'connected' || value === 'disconnected'
      || value === 'connecting' || value === 'hibernated'
}

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

  /** Motivo da última desconexão — ex: "401: logged out" */
  lastDisconnectReason?: string

  // ── Indicadores de saúde já devolvidos por /instance/all (sem custo extra) ──
  /** Conta é WhatsApp Business */
  isBusiness?: boolean
  /** Plataforma do aparelho pareado — ex: "android", "iphone", "web" */
  plataform?: string
  /** Nome do sistema exibido em "Aparelhos conectados" no celular */
  systemName?: string
  /** Presença atual — ex: "available" | "unavailable" */
  current_presence?: string
  /** Campos administrativos livres (admintoken) — usados para carimbar metadados */
  adminField01?: string
  adminField02?: string

  // Extra fields returned by uazapiGO (stored for reference only)
  profileInfo?: {
    name?: string
    picture?: string
  }
}

// ─── Diagnóstico: limites de novas conversas (GET /instance/wa_messages_limits) ─

/**
 * Cota de novas conversas do WhatsApp. É a causa nº1 de "o agente parou de
 * responder" SEM desconexão — o número segue conectado mas é impedido de
 * iniciar conversas novas (provider_code 463).
 */
export interface WaMessagesLimits {
  provider?: string
  reachable?: boolean
  /** null = diagnóstico não concluiu (não trate como bloqueado) */
  can_send_new_messages?: boolean | null
  error_key?: string
  message?: string
  message_ptbr?: string
  provider_message?: string
  provider_message_ptbr?: string
  diagnostics_endpoint?: string
  new_chat_message_capping?: {
    available?: boolean
    status?: string
    used_quota?: number
    total_quota?: number
    cycle_start?: string
    cycle_end?: string
    server_sent_at?: string
    ote_status?: string
    mv_status?: string
    lookup_error?: string
  }
  reachout_timelock?: {
    available?: boolean
    active?: boolean
    until?: string
    enforcement_type?: string
    lookup_error?: string
  }
}

// ─── Diagnóstico: erros de entrega de webhook (somente leitura) ──────────────

/** Item de GET /webhook/errors (instância) e GET /globalwebhook/errors (admin). */
export interface WebhookDeliveryError {
  created?: string
  url?: string
  type?: 'local' | 'global'
  event?: string
  message_type?: string
  status_code?: number
  attempts?: number
  error?: string
  payload?: unknown
}

/**
 * Item de GET /webhook — a configuração de webhook DA INSTÂNCIA.
 * ⚠️ SOMENTE LEITURA. Esses webhooks pertencem aos agentes de IA no n8n.
 */
export interface InstanceWebhookConfig {
  id?: string
  enabled?: boolean
  url?: string
  events?: string[]
  addUrlEvents?: boolean
  addUrlTypesMessages?: boolean
  excludeMessages?: string[]
}

// ─── Diagnóstico: proxy (GET /instance/proxy) ───────────────────────────────

/**
 * A API separa INTENÇÃO (`mode`) de REALIDADE (`effective_mode`) — quando os
 * dois divergem, ou `fallback.active` é true, a instância está rodando fora do
 * proxy contratado.
 */
export interface InstanceProxy {
  mode?: 'custom' | 'internal' | 'none'
  effective_mode?: 'custom' | 'internal' | 'direct'
  effective_detail?: string
  fallback?: {
    active?: boolean
    reason?: string
    since?: string
  }
  proxy_url?: string
  proxy_fallback?: string
  managed?: unknown
  last_test_at?: string
  last_test_error?: string
  validation_error?: string
}

// ─── Diagnóstico: fila de envio assíncrono (GET /message/async) ──────────────

/** Detecta agente travado mesmo sem desconexão. */
export interface AsyncQueueStatus {
  response?: string
  instanceId?: string
  queue?: {
    status?: 'idle' | 'queued' | 'processing' | 'waiting_connection' | 'resetting'
    pending?: number
    processingNow?: number
    acceptingNewMessages?: boolean
    sessionReady?: boolean
    resetting?: boolean
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
