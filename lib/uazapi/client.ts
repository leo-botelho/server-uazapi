import type {
  UazapiInstance, ConnectRequest, ConnectResponse, ConnectResponseRaw, StatusResponseRaw,
  ProxyCity, GlobalWebhookConfig, GlobalWebhookResponse,
  WaMessagesLimits, WebhookDeliveryError, InstanceWebhookConfig, InstanceProxy, AsyncQueueStatus,
} from './types'
import type {
  UazapiGroup, UazapiGroupMutation, UazapiGroupListPage, UazapiParticipantsResult,
  UazapiInviteReset, UazapiEphemeralDuration, UazapiMemberAddMode, UazapiParticipantAction,
  UazapiChatDetails, UazapiChatFindPage, UazapiSendResult, UazapiMediaType, UazapiMenuType,
  UazapiMentions,
} from './group-types'

/**
 * Listagens de grupo são lentas: com muitos grupos e `force: true` o uazapiGO
 * passa folgado dos 15 s padrão.
 */
const LIST_TIMEOUT_MS = 30_000

/**
 * Remove todo espaco em branco de URLs e tokens vindos de secrets.
 * Valores colados de terminais que quebram linha chegam com newline no meio, o
 * que produz URL malformada e header `admintoken` invalido.
 */
export function normalizeSecret(value: string | undefined | null): string {
  return (value ?? '').replace(/\s+/g, '')
}

function normalizeUrl(value: string): string {
  return normalizeSecret(value).replace(/\/$/, '')
}

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
    //
    // Isso vale também para o módulo de grupos: ele NÃO assina webhook por
    // instância para saber de entradas em grupo. O evento `groups` entra no
    // webhook GLOBAL, que é do painel, e o cache de grupos se mantém por TTL,
    // por botão e pelo objeto `group` que toda mutação já devolve.

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

    // ─── Grupos ───────────────────────────────────────────────────────────
    //
    // Todos usam o token DA INSTÂNCIA. O id do grupo é o JID completo
    // (`120363...@g.us`) e o campo se chama `groupjid`, tudo minúsculo.
    // As exceções de caixa estão marcadas uma a uma — errar não dá erro, o
    // campo só é ignorado.

    groups: {
      /**
       * GET /group/list — listagem direta, sem paginação.
       * ⚠️ Na query o parâmetro é `noparticipants`, TUDO MINÚSCULO
       * (no corpo do POST abaixo ele é `noParticipants`, camelCase).
       */
      listAll: (token: string, opts: { force?: boolean; noParticipants?: boolean } = {}) =>
        request<{ groups: UazapiGroup[] }>(
          `/group/list?force=${opts.force ? 'true' : 'false'}` +
          `&noparticipants=${opts.noParticipants ? 'true' : 'false'}`,
          { token, timeoutMs: LIST_TIMEOUT_MS }
        ),

      /**
       * POST /group/list — com busca e paginação. `limit` máximo 1000.
       * ⚠️ Aqui o campo é `noParticipants`, camelCase.
       */
      listPage: (token: string, body: {
        limit?: number
        offset?: number
        /** Filtra por nome ou JID. */
        search?: string
        force?: boolean
        noParticipants?: boolean
      }) =>
        request<UazapiGroupListPage>('/group/list', {
          method: 'POST',
          token,
          body: JSON.stringify({ limit: 200, offset: 0, ...body }),
          timeoutMs: LIST_TIMEOUT_MS,
        }),

      info: (token: string, body: {
        groupjid: string
        getInviteLink?: boolean
        /** Traz os pedidos pendentes em `request_participants`. */
        getRequestsParticipants?: boolean
        force?: boolean
      }) =>
        request<UazapiGroup>('/group/info', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /**
       * POST /group/updateName — exige admin.
       * ⚠️ Máximo de 25 caracteres (criar um grupo aceita 100).
       */
      updateName: (token: string, body: { groupjid: string; name: string }) =>
        request<UazapiGroupMutation>('/group/updateName', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /**
       * POST /group/updateDescription — exige admin.
       * ⚠️ Máximo de 512 caracteres; acima disso a API devolve 413.
       */
      updateDescription: (token: string, body: { groupjid: string; description: string }) =>
        request<UazapiGroupMutation>('/group/updateDescription', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /**
       * POST /group/updateImage — exige admin.
       * `image` aceita URL, base64, ou o literal `'remove'`/`'delete'`.
       * ⚠️ O WhatsApp exige JPEG de no máximo 640x640: 413 se for grande
       * demais, 415 se não for JPEG.
       */
      updateImage: (token: string, body: { groupjid: string; image: string }) =>
        request<UazapiGroupMutation>('/group/updateImage', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /** `announce: true` = só admin manda mensagem. Exige admin. */
      updateAnnounce: (token: string, body: { groupjid: string; announce: boolean }) =>
        request<UazapiGroupMutation>('/group/updateAnnounce', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /** `locked: true` = só admin edita nome/foto/descrição. Exige admin. */
      updateLocked: (token: string, body: { groupjid: string; locked: boolean }) =>
        request<UazapiGroupMutation>('/group/updateLocked', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /** ⚠️ O campo do corpo é PascalCase: `IsJoinApprovalRequired`. */
      updateJoinApproval: (token: string, body: { groupjid: string; IsJoinApprovalRequired: boolean }) =>
        request<UazapiGroupMutation>('/group/updateJoinApproval', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /** ⚠️ O campo do corpo é PascalCase: `MemberAddMode`. */
      updateMemberAddMode: (token: string, body: { groupjid: string; MemberAddMode: UazapiMemberAddMode }) =>
        request<UazapiGroupMutation>('/group/updateMemberAddMode', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /** Mensagens temporárias. `duration` aceita string ou inteiro. Exige admin. */
      ephemeral: (token: string, body: { groupjid: string; duration: UazapiEphemeralDuration }) =>
        request<UazapiGroupMutation>('/group/ephemeral', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /**
       * POST /group/updateParticipants — exige admin.
       * Números em formato internacional sem `+`, ou JIDs completos.
       * O resultado vem por número em `groupUpdated[]`, com `Error: 0` = sucesso.
       * ⚠️ A spec não documenta tamanho máximo do lote (criar grupo limita a 50).
       */
      updateParticipants: (token: string, body: {
        groupjid: string
        action: UazapiParticipantAction
        participants: string[]
      }) =>
        request<UazapiParticipantsResult>('/group/updateParticipants', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /** `name` até 100 caracteres aqui; `participants` de 1 a 50. */
      create: (token: string, body: { name: string; participants: string[] }) =>
        request<UazapiGroupMutation>('/group/create', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /** `invitecode` aceita o código ou a URL completa do convite. */
      join: (token: string, body: { invitecode: string }) =>
        request<UazapiGroupMutation>('/group/join', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /** Espia um grupo pelo convite, antes de entrar. */
      inviteInfo: (token: string, body: { invitecode: string }) =>
        request<UazapiGroup>('/group/inviteInfo', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /** ⚠️ Se o número for o ÚLTIMO admin, o grupo é DISSOLVIDO. */
      leave: (token: string, body: { groupjid: string }) =>
        request<UazapiGroupMutation>('/group/leave', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /**
       * POST /group/resetInviteCode — invalida o link antigo e gera outro.
       * ⚠️ Devolve `InviteLink` com I maiúsculo; o objeto `Group` usa
       * `invite_link`. Exige admin.
       */
      resetInviteCode: (token: string, body: { groupjid: string }) =>
        request<UazapiInviteReset>('/group/resetInviteCode', {
          method: 'POST', token, body: JSON.stringify(body),
        }),
    },

    community: {
      create: (token: string, body: { name: string }) =>
        request<{ group?: UazapiGroup; failed?: string[] }>('/community/create', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /** ⚠️ Os campos são `community` (JID da comunidade) e `groupjids` (array). */
      editGroups: (token: string, body: {
        community: string
        action: 'add' | 'remove'
        groupjids: string[]
      }) =>
        request<{ message?: string; success?: string[]; failed?: string[] }>('/community/editgroups', {
          method: 'POST', token, body: JSON.stringify(body),
        }),
    },

    chat: {
      /**
       * POST /chat/details — funciona para grupo. É daqui que sai o avatar.
       * ⚠️ `image` só vem com `preview: false`; `imagePreview` só com `true`.
       */
      details: (token: string, body: { number: string; preview?: boolean }) =>
        request<UazapiChatDetails>('/chat/details', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /** POST /chat/find — o caminho mais barato para listar grupos COM avatar. */
      find: (token: string, body: {
        operator?: 'AND' | 'OR'
        sort?: string
        limit?: number
        offset?: number
        wa_isGroup?: boolean
        wa_isGroup_admin?: boolean
        /** ID da etiqueta aplicada ao chat — o de `/labels`, não o nome. */
        wa_label?: string
        search?: string
      }) =>
        request<UazapiChatFindPage>('/chat/find', {
          method: 'POST',
          token,
          body: JSON.stringify(body),
          timeoutMs: LIST_TIMEOUT_MS,
        }),

      /** Confere se os números existem no WhatsApp — usar antes de adicionar. */
      check: (token: string, body: { numbers: string[] }) =>
        request<{ chats?: { query: string; isInWhatsapp?: boolean; jid?: string; groupName?: string }[] }>(
          '/chat/check', { method: 'POST', token, body: JSON.stringify(body) }
        ),
    },

    send: {
      /**
       * POST /send/text. `number` aceita JID de grupo (`...@g.us`).
       * `mentions: 'all'` marca todo mundo — só funciona em grupo.
       * `delay` é em MILISSEGUNDOS e mostra "digitando…" durante a espera.
       */
      text: (token: string, body: {
        number: string
        text: string
        mentions?: UazapiMentions
        delay?: number
        linkPreview?: boolean
        replyid?: string
        track_source?: string
        track_id?: string
      }) =>
        request<UazapiSendResult>('/send/text', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /** POST /send/media. `file` aceita URL ou base64; `text` é a legenda. */
      media: (token: string, body: {
        number: string
        type: UazapiMediaType
        file: string
        text?: string
        docName?: string
        mimetype?: string
        mentions?: UazapiMentions
        delay?: number
      }) =>
        request<UazapiSendResult>('/send/media', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /**
       * POST /send/menu — botões, listas, enquetes e carrosséis.
       *
       * ⚠️ Os botões não são campos estruturados: vão como strings codificadas
       * em `choices[]`. Use `montarChoicesDeBotoes()` em `lib/groups/buttons.ts`
       * em vez de montar a string à mão.
       */
      menu: (token: string, body: {
        number: string
        type: UazapiMenuType
        text: string
        choices: string[]
        footerText?: string
        listButton?: string
        selectableCount?: number
        /** URL ou base64 de uma imagem acima dos botões. */
        imageButton?: string
        mentions?: UazapiMentions
        delay?: number
      }) =>
        request<UazapiSendResult>('/send/menu', {
          method: 'POST', token, body: JSON.stringify(body),
        }),
    },

    /**
     * Etiquetas do WhatsApp Business. ⚠️ O ID aparece como `id` (schema) e como `labelid` (edição):
     * quem lê a resposta usa `lerEtiquetas()` em `lib/groups/etiquetas.ts`, que aceita os dois.
     */
    labels: {
      /** GET /labels. */
      list: (token: string) => request<unknown>('/labels', { token }),

      /**
       * POST /label/edit. `labelid: 'new'` cria; um ID real edita; `delete: true` apaga.
       * ⚠️ Apagar tira a etiqueta de TODAS as conversas da instância.
       */
      edit: (token: string, body: { labelid: string; name?: string; color?: number; delete?: boolean }) =>
        request<{ response?: string }>('/label/edit', {
          method: 'POST', token, body: JSON.stringify(body),
        }),

      /** POST /chat/labels. Use UM dos três campos de etiqueta por pedido; `number` aceita JID de grupo. */
      setChat: (token: string, body: { number: string; add_labelid?: string; remove_labelid?: string }) =>
        request<unknown>('/chat/labels', {
          method: 'POST', token, body: JSON.stringify(body),
        }),
    },

    message: {
      /**
       * POST /message/find — busca mensagens.
       * Com `{ id }` lê uma mensagem específica: é o único caminho existente
       * para ler a apuração de uma enquete (campo `vote`).
       */
      find: (token: string, body: {
        id?: string
        chatid?: string
        limit?: number
        offset?: number
      }) =>
        request<{ messages: Record<string, unknown>[]; hasMore?: boolean }>('/message/find', {
          method: 'POST', token, body: JSON.stringify(body),
        }),
    },
  }
}

// Default client using env vars (fallback for server-side usage without DB lookup)
// `.trim()` porque um secret gravado via `echo` carrega uma quebra de linha no
// fim — isso quebra a URL base e torna o header `admintoken` invalido.
const defaultBaseUrl = normalizeUrl(process.env.UAZAPI_BASE_URL ?? 'https://free.uazapi.com')
const defaultAdminToken = normalizeSecret(process.env.UAZAPI_ADMIN_TOKEN)

export const uazapi = createUazapiClient(defaultBaseUrl, defaultAdminToken)

// Factory: create a client bound to a specific server's URL and admin token
export function createUazapi(serverUrl: string, adminToken: string) {
  return createUazapiClient(normalizeUrl(serverUrl), normalizeSecret(adminToken))
}

export type UazapiClient = ReturnType<typeof createUazapiClient>
