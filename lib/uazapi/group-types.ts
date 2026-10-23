/**
 * Tipos dos endpoints de grupo do uazapiGO.
 *
 * Ficam separados de `types.ts` para o `client.ts` crescer só em invólucros
 * finos — o `request` dele é privado ao closure e mexer na assinatura dele
 * tocaria em todo caminho de produção.
 *
 * ⚠️ A API mistura convenções de nome. O que está escrito aqui foi conferido na
 * spec (`uazapi-openapi-spec.yaml`); errar a caixa de uma letra não dá erro,
 * só faz o campo ser ignorado em silêncio:
 *   - o objeto `Group` usa PascalCase (`JID`, `Name`, `Topic`, `OwnerIsAdmin`);
 *   - os corpos de requisição usam minúsculo (`groupjid`, `announce`, `name`)…
 *   - …EXCETO `IsJoinApprovalRequired` e `MemberAddMode`, que são PascalCase;
 *   - `/group/resetInviteCode` devolve `InviteLink`, mas o `Group` traz
 *     `invite_link`;
 *   - `request_participants` é uma STRING separada por vírgula, não um array.
 */

export interface UazapiGroupParticipant {
  JID: string
  LID?: string
  PhoneNumber?: string
  IsAdmin?: boolean
  IsSuperAdmin?: boolean
  /** Nome exibido no grupo (para quem está anônimo). */
  DisplayName?: string
  /** Código de erro ao adicionar este participante. 0 = sucesso. */
  Error?: number
  AddRequest?: { Code?: string; Expiration?: string }
}

export interface UazapiGroup {
  JID: string
  Name?: string
  /** A descrição do grupo. O nome do campo é `Topic`, não `Description`. */
  Topic?: string
  OwnerJID?: string
  OwnerPN?: string

  IsLocked?: boolean
  IsAnnounce?: boolean
  IsEphemeral?: boolean
  DisappearingTimer?: number
  /** É uma comunidade (grupo-pai). */
  IsParent?: boolean
  IsJoinApprovalRequired?: boolean
  LinkedParentJID?: string
  IsDefaultSubGroup?: boolean
  DefaultSubGroupId?: string

  MemberAddMode?: UazapiMemberAddMode
  AddressingMode?: 'pn' | 'lid'

  /** VOCÊ é admin deste grupo. Portão de toda edição. */
  OwnerIsAdmin?: boolean
  /** VOCÊ pode mandar mensagem aqui. Portão de todo envio. */
  OwnerCanSendMessage?: boolean

  Participants?: UazapiGroupParticipant[]
  ParticipantVersionID?: string
  GroupCreated?: string

  /** Só vem preenchido com `getInviteLink: true` ou após um reset. */
  invite_link?: string
  /** ⚠️ String separada por vírgula, não array. */
  request_participants?: string
}

/** Resposta padrão das mutações de grupo. */
export interface UazapiGroupMutation {
  response?: string
  group?: UazapiGroup
  /** O servidor avisa que o cache local dele ficou velho. */
  needs_refresh?: boolean
}

export interface UazapiGroupListPage {
  groups: UazapiGroup[]
  pagination?: { totalRecords: number; limit: number; offset: number }
}

export interface UazapiParticipantsResult {
  /** `Error: 0` significa sucesso para aquele número. */
  groupUpdated?: { JID: string; Error: number }[]
  group?: UazapiGroup
  needs_refresh?: boolean
}

export interface UazapiInviteReset {
  /** ⚠️ `I` maiúsculo aqui; no objeto `Group` o campo é `invite_link`. */
  InviteLink?: string
  group?: UazapiGroup
  needs_refresh?: boolean
}

/** Aceita string OU inteiro — `0` e `'off'` são equivalentes. */
export type UazapiEphemeralDuration = 0 | 'off' | '1d' | '7d' | '90d'

export type UazapiMemberAddMode = 'admin_add' | 'all_member_add'

export type UazapiParticipantAction =
  | 'add'
  | 'remove'
  | 'promote'
  | 'demote'
  /** Aprova pedidos pendentes de entrada. */
  | 'approve'
  /** Rejeita pedidos pendentes de entrada. */
  | 'reject'

/** Resultado de `/chat/details` — é daqui que sai o avatar de um grupo. */
export interface UazapiChatDetails {
  /** Preenchido quando `preview: false`. */
  image?: string
  /** Preenchido quando `preview: true`. */
  imagePreview?: string
  name?: string
  wa_chatid?: string
  common_groups?: string
}

/**
 * Uma linha de `/chat/find`. O schema é largo e varia por build, então só os
 * campos que o painel realmente lê estão tipados.
 */
export interface UazapiChatRow {
  wa_chatid?: string
  name?: string
  wa_name?: string
  wa_contactName?: string
  image?: string
  imagePreview?: string
  wa_isGroup?: boolean
  wa_isGroup_admin?: boolean
  wa_isGroup_announce?: boolean
  wa_isGroup_community?: boolean
  wa_isGroup_member?: boolean
  [key: string]: unknown
}

export interface UazapiChatFindPage {
  chats: UazapiChatRow[]
  pagination?: { totalRecords: number }
}

/** Retorno dos endpoints de envio. O nome do id varia por build. */
export interface UazapiSendResult {
  messageid?: string
  id?: string
  response?: { status?: string; message?: string }
}

export type UazapiMediaType =
  | 'image' | 'video' | 'videoplay' | 'document'
  | 'audio' | 'myaudio' | 'ptt' | 'ptv' | 'sticker'

export type UazapiMenuType = 'button' | 'list' | 'poll' | 'carousel'

/**
 * Menção em grupo.
 *
 * `'all'` marca todo mundo. Caso contrário, números separados por vírgula.
 * Só funciona em grupo — em conversa individual o campo é ignorado.
 */
export type UazapiMentions = 'all' | (string & {})
