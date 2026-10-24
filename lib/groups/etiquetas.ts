import type { Validado } from './gestao'

/**
 * Etiquetas (labels) do WhatsApp Business, usadas para SEGMENTAR: "selecionar todos os grupos da
 * etiqueta Turma de março" em vez de marcar grupo a grupo.
 *
 * O que a spec garante: `GET /labels` lista, `POST /chat/labels` aplica/remove (aceita grupo em
 * `number`), `POST /label/edit` cria/edita/apaga, e `POST /chat/find` filtra por `wa_label` (o ID
 * da etiqueta, "não o nome"). O que ela NÃO garante: o nome do campo do ID (o schema diz `id`, a
 * edição fala em `labelid`) — por isso a leitura aceita os dois.
 *
 * ⚠️ Etiqueta é recurso do WhatsApp Business. Em número comum a lista vem vazia ou dá erro, e a
 * tela explica isso em vez de fingir que não há etiquetas.
 */

export interface Etiqueta {
  /** O que se manda de volta em `wa_label`, `add_labelid`, `remove_labelid` e `labelid`. */
  id: string
  nome: string
  /** Índice 0–19 da cor, quando a API diz. */
  cor: number | null
  corHex: string | null
}

/** As 20 cores do WhatsApp, na ordem do índice (a do schema da spec). */
export const CORES_DAS_ETIQUETAS = [
  '#ff9484', '#64c4ff', '#fed428', '#dfaef0', '#9ab6c1', '#56ccb4', '#fe9dfe', '#d3a91f', '#6f7bcf', '#d8e651',
  '#01d0e2', '#ffc5c7', '#92ceac', '#f64847', '#00a1f2', '#83e421', '#ffae04', '#b4ebff', '#9ba6ff', '#9568cf',
] as const

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Um id que não pode virar parte de um corpo de requisição estranho: só letras, números, `_` e `-`. */
const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/

export const idDeEtiquetaValido = (v: unknown): v is string => typeof v === 'string' && ID_VALIDO.test(v) && v !== 'new'

/**
 * Lê a resposta de `GET /labels`. Aceita a lista direta ou dentro de `labels`, e o ID como `id`,
 * `labelid` ou `labelId` (a spec usa os dois). Descarta o que não tem ID válido e nome. Nunca lança.
 */
export function lerEtiquetas(resposta: unknown): Etiqueta[] {
  const lista = Array.isArray(resposta)
    ? resposta
    : ehObjeto(resposta) && Array.isArray(resposta.labels) ? resposta.labels : []

  const vistos = new Set<string>()
  const saida: Etiqueta[] = []

  for (const item of lista) {
    if (!ehObjeto(item)) continue

    const bruto = item.id ?? item.labelid ?? item.labelId ?? item.ID
    const id = typeof bruto === 'number' ? String(bruto) : bruto
    if (!idDeEtiquetaValido(id) || vistos.has(id)) continue

    const nome = typeof item.name === 'string' ? item.name.trim() : typeof item.Name === 'string' ? item.Name.trim() : ''
    if (!nome) continue

    const cor = typeof item.color === 'number' && Number.isInteger(item.color) && item.color >= 0 && item.color < 20 ? item.color : null
    const corHex = typeof item.colorHex === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.colorHex)
      ? item.colorHex
      : cor !== null ? CORES_DAS_ETIQUETAS[cor] : null

    vistos.add(id)
    saida.push({ id, nome, cor, corHex })
  }

  return saida.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

/** A spec não documenta limite para o nome; 100 é teto de sanidade, não regra do WhatsApp. */
export const MAX_NOME_DA_ETIQUETA = 100

export function validarNomeDaEtiqueta(bruto: unknown): Validado<string> {
  if (typeof bruto !== 'string') return { ok: false, erro: 'Informe o nome da etiqueta.' }
  const nome = bruto.trim()
  if (!nome) return { ok: false, erro: 'O nome da etiqueta não pode ficar vazio.' }
  if ([...nome].length > MAX_NOME_DA_ETIQUETA) return { ok: false, erro: `O nome aceita no máximo ${MAX_NOME_DA_ETIQUETA} caracteres.` }
  return { ok: true, valor: nome }
}

export function validarCorDaEtiqueta(bruta: unknown): Validado<number> {
  return typeof bruta === 'number' && Number.isInteger(bruta) && bruta >= 0 && bruta <= 19
    ? { ok: true, valor: bruta }
    : { ok: false, erro: 'Escolha uma das 20 cores.' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Grupos de uma etiqueta
// ─────────────────────────────────────────────────────────────────────────────

const JID_DE_GRUPO = /^[0-9][0-9-]*@g\.us$/

/**
 * Os JIDs de GRUPO de uma página de `POST /chat/find`. Mesmo com `wa_isGroup: true` na busca,
 * confere o formato: conversa individual com a mesma etiqueta nunca pode entrar na seleção de
 * grupos de uma campanha.
 */
export function gruposDaBusca(pagina: unknown): string[] {
  if (!ehObjeto(pagina) || !Array.isArray(pagina.chats)) return []

  const vistos = new Set<string>()
  for (const c of pagina.chats) {
    if (!ehObjeto(c)) continue
    const jid = c.wa_chatid
    if (typeof jid === 'string' && JID_DE_GRUPO.test(jid)) vistos.add(jid)
  }
  return [...vistos]
}

/**
 * Cruza os grupos que têm a etiqueta com os que o painel conhece (o cache). Só dá para
 * selecionar o que está na lista; o resto vira aviso ("atualize a lista"), nunca é inventado.
 */
export function planejarSelecaoPorEtiqueta(
  comEtiqueta: string[],
  conhecidos: Set<string>
): { selecionar: string[]; foraDaLista: number } {
  const selecionar = comEtiqueta.filter((j) => conhecidos.has(j))
  return { selecionar, foraDaLista: comEtiqueta.length - selecionar.length }
}

/** Quantas páginas de 200 a busca percorre no máximo (1000 grupos): teto contra laço infinito. */
export const PAGINAS_MAXIMAS_DA_BUSCA = 5
export const TAMANHO_DA_PAGINA_DA_BUSCA = 200
