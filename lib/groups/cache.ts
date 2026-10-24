import { createServiceClient } from '@/lib/supabase/server'
import { getInstanceClient } from '@/lib/api-helpers'
import type { UazapiClient } from '@/lib/uazapi/client'
import type { Json } from '@/types/database'
import {
  camposParaAtualizar,
  mapearGrupoParaLinha,
  type GrupoEmCache,
} from './cache-regras'
import type { UazapiGroup } from '@/lib/uazapi/group-types'

/**
 * Cache dos grupos de cada instância.
 *
 * Listar grupos na uazapiGO é uma chamada remota lenta, e a tela precisa de
 * busca e seleção instantâneas. O cache é a fonte da tela; a uazapiGO só é
 * consultada quando ele está velho, a pessoa pede, ou uma mutação devolve o
 * grupo já atualizado.
 *
 * ⚠️ Nada aqui depende de webhook. O evento `groups` só existe no webhook
 * GLOBAL, e o webhook POR INSTÂNCIA pertence aos agentes de IA no n8n.
 */

/** Tamanho de cada página pedida à uazapiGO. Pequeno de propósito: ver `atualizarCacheDeGrupos`. */
const TAMANHO_DA_PAGINA = 200

/** Teto de páginas por atualização (4000 grupos). Sem isso, um erro de paginação viraria laço infinito. */
const MAX_PAGINAS = 20

/** Linhas por lote ao apagar grupos que sumiram. */
const LOTE_DE_REMOCAO = 100

const COLUNAS_DA_LISTA =
  'group_jid, name, topic, image_url, participant_count, owner_is_admin, ' +
  'owner_can_send, is_announce, is_locked, is_parent, fetched_at'

export interface ResultadoDaAtualizacao {
  /** Quantos grupos a uazapiGO devolveu e foram gravados. */
  atualizados: number
  /** Grupos que estavam no cache e não existem mais (o número saiu deles). */
  removidos: number
  /**
   * A listagem não trouxe `OwnerIsAdmin`, então o status de admin foi inferido
   * por outro caminho (`/chat/find`). Ver o comentário em `atualizarCacheDeGrupos`.
   */
  adminInferido: boolean
  duracaoMs: number
}

/**
 * Busca os grupos na uazapiGO e grava no cache.
 *
 * Processa UMA página por vez e grava antes de pedir a próxima. Nunca guarda a
 * listagem inteira em memória: materializar resultado grande dentro do Worker
 * foi exatamente o que estourou o limite de CPU no monitor.
 *
 * Pede `noParticipants: true` pelo mesmo motivo — a lista de participantes de
 * todos os grupos é a parte pesada da resposta e o cache só precisa da contagem.
 *
 * ⚠️ Não verificado contra uma instância real: se a listagem sem participantes
 * ainda devolve `OwnerIsAdmin`. Se não devolver, o status de admin cai no
 * fallback via `/chat/find { wa_isGroup_admin: true }` (último passo abaixo).
 */
export async function atualizarCacheDeGrupos(
  instanceId: string,
  opcoes: { force?: boolean } = {}
): Promise<ResultadoDaAtualizacao> {
  const inicio = Date.now()

  const resolvida = await getInstanceClient(instanceId)
  if (!resolvida) throw new Error('Instância não encontrada.')

  const { client, uazapiToken } = resolvida
  const db = await createServiceClient()

  const vistos = new Set<string>()
  let veioAdmin = false
  let completo = false

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const offset = pagina * TAMANHO_DA_PAGINA

    const resposta = await client.groups.listPage(uazapiToken, {
      limit: TAMANHO_DA_PAGINA,
      offset,
      // `force` só na primeira página: ele pede ao WhatsApp para recarregar a
      // lista, e repetir isso a cada página refaria o mesmo trabalho.
      force: pagina === 0 ? opcoes.force === true : false,
      noParticipants: true,
    })

    const grupos = (resposta.groups ?? []).filter((g) => typeof g.JID === 'string' && g.JID)

    if (grupos.length > 0) {
      for (const g of grupos) {
        vistos.add(g.JID)
        if (typeof g.OwnerIsAdmin === 'boolean') veioAdmin = true
      }

      const { error } = await db.rpc('refresh_group_cache_upsert', {
        p_instance: instanceId,
        p_rows: grupos.map(mapearGrupoParaLinha) as unknown as Json,
      })
      if (error) throw new Error(`Falha ao gravar o cache de grupos: ${error.message}`)
    }

    const total = resposta.pagination?.totalRecords
    const fim =
      grupos.length === 0 ||
      grupos.length < TAMANHO_DA_PAGINA ||
      (typeof total === 'number' && offset + grupos.length >= total)

    if (fim) {
      completo = true
      break
    }
  }

  // ── Admin: fallback quando a listagem não trouxe `OwnerIsAdmin` ───────────
  // Sem este passo todo grupo ficaria com `owner_is_admin = false` e a edição
  // pareceria bloqueada em todos eles. É o lado seguro do erro, mas inútil.
  let adminInferido = false
  if (vistos.size > 0 && !veioAdmin) {
    adminInferido = await inferirAdmins(instanceId, client, uazapiToken)
  }

  // ── Grupos que sumiram ─────────────────────────────────────────────────────
  // Só depois de uma listagem COMPLETA: com uma página faltando, "não apareceu"
  // não significa "não existe mais". Compara por JID, nunca por data — o relógio
  // do Worker e o do Postgres podem divergir e apagaria linhas recém-gravadas.
  let removidos = 0
  if (completo) {
    removidos = await removerGruposQueSumiram(instanceId, vistos)
  }

  return {
    atualizados: vistos.size,
    removidos,
    adminInferido,
    duracaoMs: Date.now() - inicio,
  }
}

async function inferirAdmins(
  instanceId: string,
  client: UazapiClient,
  token: string
): Promise<boolean> {
  const db = await createServiceClient()

  try {
    let alguma = false

    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const offset = pagina * TAMANHO_DA_PAGINA
      const resposta = await client.chat.find(token, {
        wa_isGroup: true,
        wa_isGroup_admin: true,
        limit: TAMANHO_DA_PAGINA,
        offset,
      })

      const jids = (resposta.chats ?? [])
        .map((c) => c.wa_chatid)
        .filter((j): j is string => typeof j === 'string' && j.endsWith('@g.us'))

      if (jids.length > 0) {
        const { error } = await db
          .from('group_cache')
          .update({ owner_is_admin: true })
          .eq('instance_id', instanceId)
          .in('group_jid', jids)
        if (error) throw new Error(error.message)
        alguma = true
      }

      if ((resposta.chats ?? []).length < TAMANHO_DA_PAGINA) break
    }

    return alguma
  } catch (err) {
    // Não derruba a atualização: o cache já está gravado e "ninguém é admin" é
    // o lado seguro. Só registra.
    console.warn(
      '[groups/cache] não foi possível inferir os admins:',
      err instanceof Error ? err.message : String(err)
    )
    return false
  }
}

async function removerGruposQueSumiram(instanceId: string, vistos: Set<string>): Promise<number> {
  const db = await createServiceClient()

  // Lê só os JIDs, em páginas — o PostgREST corta em 1000 linhas por consulta.
  const emCache: string[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db
      .from('group_cache')
      .select('group_jid')
      .eq('instance_id', instanceId)
      .range(de, de + 999)

    if (error) {
      console.warn('[groups/cache] falha ao ler o cache para limpar:', error.message)
      return 0
    }
    emCache.push(...(data ?? []).map((r) => r.group_jid))
    if ((data ?? []).length < 1000) break
  }

  const sobrando = emCache.filter((jid) => !vistos.has(jid))
  let removidos = 0

  for (let i = 0; i < sobrando.length; i += LOTE_DE_REMOCAO) {
    const lote = sobrando.slice(i, i + LOTE_DE_REMOCAO)
    const { error } = await db
      .from('group_cache')
      .delete()
      .eq('instance_id', instanceId)
      .in('group_jid', lote)

    if (error) {
      console.warn('[groups/cache] falha ao remover grupos que sumiram:', error.message)
      break
    }
    removidos += lote.length
  }

  return removidos
}

/**
 * Guarda no cache o grupo que uma mutação devolveu, para a tela refletir a
 * mudança sem depender de uma nova listagem (que exige o webhook `groups`, que
 * este módulo não pode assinar por instância).
 *
 * Nunca lança: o cache é conveniência. A mudança no WhatsApp já aconteceu e não
 * pode virar erro para o operador só porque o espelho local falhou.
 */
export async function atualizarCacheComGrupo(
  instanceId: string,
  grupo: UazapiGroup | undefined
): Promise<void> {
  if (!grupo?.JID) return

  try {
    const db = await createServiceClient()
    const { error } = await db
      .from('group_cache')
      .update(camposParaAtualizar(grupo))
      .eq('instance_id', instanceId)
      .eq('group_jid', grupo.JID)

    if (error) console.warn('[groups/cache] não foi possível atualizar o cache:', error.message)
  } catch (err) {
    console.warn('[groups/cache] falha ao atualizar o cache:', err instanceof Error ? err.message : String(err))
  }
}

/** Todos os grupos em cache de uma instância, ordenados por nome. */
export async function listarGruposEmCache(instanceId: string): Promise<GrupoEmCache[]> {
  const db = await createServiceClient()
  const todos: GrupoEmCache[] = []

  // PostgREST devolve no máximo 1000 linhas por consulta: pagina por `range`.
  for (let de = 0; de < 5000; de += 1000) {
    const { data, error } = await db
      .from('group_cache')
      .select(COLUNAS_DA_LISTA)
      .eq('instance_id', instanceId)
      .order('name', { ascending: true, nullsFirst: false })
      .range(de, de + 999)

    if (error) throw new Error(`Falha ao ler o cache de grupos: ${error.message}`)

    const pagina = (data ?? []) as unknown as GrupoEmCache[]
    todos.push(...pagina)
    if (pagina.length < 1000) break
  }

  return todos
}

export {
  TTL_DO_CACHE_MINUTOS,
  cacheEstaVelho,
  idadeDoCacheEmMinutos,
  mapearGrupoParaLinha,
  camposParaAtualizar,
} from './cache-regras'
export type { GrupoEmCache } from './cache-regras'

/**
 * Grava um grupo que ainda NÃO está no cache (acabou de ser criado, ou o número acabou de
 * entrar). `atualizarCacheComGrupo` só atualiza linhas existentes.
 *
 * `somosAdmin`: quem cria é admin, mas a resposta nem sempre diz — sem isto a linha nasceria
 * com `owner_is_admin = false` e a tela travaria as edições de um grupo que acabou de ser nosso.
 * Nunca lança: o grupo já foi criado no WhatsApp, e o cache se corrige no "Atualizar lista".
 */
export async function registrarGrupoNoCache(
  instanceId: string,
  grupo: UazapiGroup,
  opcoes: { somosAdmin?: boolean } = {}
): Promise<void> {
  try {
    const db = await createServiceClient()
    const completo: UazapiGroup = {
      ...grupo,
      OwnerIsAdmin: grupo.OwnerIsAdmin ?? opcoes.somosAdmin ?? false,
    }

    const { error } = await db.rpc('refresh_group_cache_upsert', {
      p_instance: instanceId,
      p_rows: [mapearGrupoParaLinha(completo)] as unknown as Json,
    })
    if (error) console.warn('[groups/cache] não foi possível registrar o grupo novo:', error.message)
  } catch (err) {
    console.warn('[groups/cache] não foi possível registrar o grupo novo:', err instanceof Error ? err.message : err)
  }
}
