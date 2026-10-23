import type { UazapiGroup } from '@/lib/uazapi/group-types'
import type { Json, Tables } from '@/types/database'

/**
 * Regras puras do cache de grupos: mapeamento, idade e validade.
 *
 * Separadas de `cache.ts` (que fala com banco e com a uazapiGO) para dar para
 * testar sem subir servidor e para a tela importar sem arrastar código de
 * servidor junto.
 */

/** Depois de quanto tempo o cache é considerado velho. */
export const TTL_DO_CACHE_MINUTOS = 15

export type GrupoEmCache = Pick<
  Tables<'group_cache'>,
  | 'group_jid' | 'name' | 'topic' | 'image_url' | 'participant_count'
  | 'owner_is_admin' | 'owner_can_send' | 'is_announce' | 'is_locked'
  | 'is_parent' | 'fetched_at'
>

/** Uma linha no formato que `refresh_group_cache_upsert` espera. */
export function mapearGrupoParaLinha(g: UazapiGroup): Record<string, Json | undefined> {
  // O objeto inteiro vai em `raw`, MENOS os participantes: são dado pessoal e
  // inflariam a linha. Guardamos só a contagem, quando ela é conhecida.
  const { Participants, ...semParticipantes } = g

  return {
    group_jid: g.JID,
    name: g.Name ?? null,
    topic: g.Topic ?? null,
    owner_jid: g.OwnerJID ?? null,
    participant_count: Participants ? Participants.length : null,
    owner_is_admin: g.OwnerIsAdmin ?? false,
    owner_can_send: g.OwnerCanSendMessage ?? true,
    is_announce: g.IsAnnounce ?? null,
    is_locked: g.IsLocked ?? null,
    is_parent: g.IsParent ?? null,
    is_join_approval_required: g.IsJoinApprovalRequired ?? null,
    member_add_mode: g.MemberAddMode ?? null,
    is_ephemeral: g.IsEphemeral ?? null,
    disappearing_timer: g.DisappearingTimer ?? null,
    linked_parent_jid: g.LinkedParentJID ?? null,
    addressing_mode: g.AddressingMode ?? null,
    invite_link: g.invite_link ?? null,
    group_created: g.GroupCreated ?? null,
    raw: semParticipantes as unknown as Json,
  }
}

/** Há quantos minutos o cache foi atualizado, ou null se está vazio. */
export function idadeDoCacheEmMinutos(grupos: Pick<GrupoEmCache, 'fetched_at'>[], agora = Date.now()): number | null {
  if (grupos.length === 0) return null

  let maisRecente = 0
  for (const g of grupos) {
    const t = Date.parse(g.fetched_at)
    if (!Number.isNaN(t) && t > maisRecente) maisRecente = t
  }
  if (maisRecente === 0) return null

  return Math.max(0, (agora - maisRecente) / 60_000)
}

export function cacheEstaVelho(grupos: Pick<GrupoEmCache, 'fetched_at'>[], agora = Date.now()): boolean {
  const idade = idadeDoCacheEmMinutos(grupos, agora)
  return idade === null || idade >= TTL_DO_CACHE_MINUTOS
}
