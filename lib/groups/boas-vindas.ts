import type { Validado } from './gestao'

/**
 * Boas-vindas: a regra de cada grupo e a leitura do evento `groups` do webhook global.
 *
 * ⚠️ O FORMATO DO EVENTO `groups` NÃO ESTÁ NA SPEC da uazapiGO. O leitor abaixo reconhece as
 * duas formas prováveis (a estrutura que a biblioteca por baixo da uazapiGO costuma expor, com
 * listas `Join`/`Leave`, e a forma "ação + participantes") e IGNORA TUDO O MAIS. Errar para o
 * lado de não reconhecer é seguro: nada acontece e a amostra do evento vai para o log
 * (`evento-grupos.ts`), de onde o formato real sai. Errar para o outro lado mandaria mensagem
 * a quem não devia — por isso só vale o que diz inequivocamente "entrou".
 */

export const MENSAGEM_PADRAO = 'Olá {{mencao}}! Seja bem-vindo(a) ao grupo. 👋'
export const MAX_MENSAGEM = 1000
export const ESPERA_PADRAO_S = 30
export const ESPERA_MINIMA_S = 5
export const ESPERA_MAXIMA_S = 3600

export interface RegraDeBoasVindas {
  enabled: boolean
  message: string
  delaySeconds: number
}

export function validarRegra(bruta: unknown): Validado<RegraDeBoasVindas> {
  if (typeof bruta !== 'object' || bruta === null) return { ok: false, erro: 'Regra inválida.' }
  const r = bruta as Record<string, unknown>

  if (typeof r.enabled !== 'boolean') return { ok: false, erro: 'Informe se as boas-vindas ficam ligadas.' }

  const message = typeof r.message === 'string' ? r.message.trim() : ''
  if (!message) return { ok: false, erro: 'Escreva a mensagem de boas-vindas.' }
  if ([...message].length > MAX_MENSAGEM) {
    return { ok: false, erro: `A mensagem aceita no máximo ${MAX_MENSAGEM} caracteres.` }
  }

  const espera = typeof r.delaySeconds === 'number' ? r.delaySeconds : Number.NaN
  if (!Number.isInteger(espera) || espera < ESPERA_MINIMA_S || espera > ESPERA_MAXIMA_S) {
    return { ok: false, erro: `A espera precisa ser de ${ESPERA_MINIMA_S} a ${ESPERA_MAXIMA_S} segundos.` }
  }

  return { ok: true, valor: { enabled: r.enabled, message, delaySeconds: espera } }
}

/** Como a mensagem vai ficar para uma pessoa, para a prévia na tela. */
export function previaDaMensagem(mensagem: string, telefoneDeExemplo = '5521987654321'): string {
  return mensagem.replaceAll('{{mencao}}', `@${telefoneDeExemplo}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Ler o evento
// ─────────────────────────────────────────────────────────────────────────────

export interface EntradaEmGrupo {
  grupo: string
  /** JIDs `@s.whatsapp.net` ou `@lid`, sem sufixo de dispositivo, sem repetição. */
  participantes: string[]
}

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

const JID_DE_GRUPO = /^[0-9][0-9-]*@g\.us$/
const JID_DE_PESSOA = /^[0-9]+(?::\d+)?@(s\.whatsapp\.net|lid)$/

const CHAVES_DO_GRUPO = ['JID', 'jid', 'GroupJID', 'groupJID', 'groupjid', 'GroupJid', 'ChatID', 'chatid', 'chatId']
const CHAVES_DE_ENTRADA = ['Join', 'join', 'Joined', 'joined', 'JoinedParticipants', 'Added', 'added', 'NewParticipants']
const CHAVES_DA_ACAO = ['Action', 'action', 'Type', 'type', 'SubType', 'subtype', 'Event', 'event']
const CHAVES_DE_PARTICIPANTES = ['Participants', 'participants', 'Users', 'users', 'Members', 'members', 'JIDs', 'jids']

/** Entrou: add, join, invite… E NÃO: remove, leave, promote, demote (que também mencionam pessoas). */
const ACAO_DE_ENTRADA = /\b(add|added|join|joined|invite|invited)\b/i
const ACAO_QUE_NAO_E_ENTRADA = /(remov|leav|left|kick|promot|demot|exit)/i

/** O objeto e os que costumam embrulhá-lo (`event`, `data`…), sem repetir. */
function raizes(raw: unknown): Record<string, unknown>[] {
  if (!ehObjeto(raw)) return []
  const candidatas = [raw, raw.event, raw.Event, raw.data, raw.Data, raw.payload, raw.GroupInfo, raw.groupInfo]
  return candidatas.filter(ehObjeto)
}

/** O JID de grupo: primeiro nas chaves esperadas, depois em qualquer valor de uma busca rasa. */
function acharGrupo(raizesDoEvento: Record<string, unknown>[]): string | null {
  for (const r of raizesDoEvento) {
    for (const k of CHAVES_DO_GRUPO) {
      const v = r[k]
      if (typeof v === 'string' && JID_DE_GRUPO.test(v)) return v
    }
  }

  const varrer = (v: unknown, profundidade: number): string | null => {
    if (typeof v === 'string') return JID_DE_GRUPO.test(v) ? v : null
    if (profundidade >= 3 || typeof v !== 'object' || v === null) return null
    for (const filho of Object.values(v)) {
      const achou = varrer(filho, profundidade + 1)
      if (achou) return achou
    }
    return null
  }

  for (const r of raizesDoEvento) {
    const achou = varrer(r, 0)
    if (achou) return achou
  }
  return null
}

/** Um item da lista (texto ou objeto) como JID de pessoa normalizado, ou null. */
function paraJidDePessoa(item: unknown): string | null {
  let jid: string | null = null

  if (typeof item === 'string') {
    jid = item
  } else if (ehObjeto(item)) {
    const principal = item.JID ?? item.jid ?? item.ID ?? item.id
    const telefone = item.PhoneNumber ?? item.phoneNumber ?? item.PN ?? item.pn
    const digitos = typeof telefone === 'string' ? telefone.split('@')[0].replace(/\D/g, '') : ''

    // Em grupo LID o identificador é opaco; com o telefone dá para marcar a pessoa de verdade.
    if (digitos.length >= 8) jid = `${digitos}@s.whatsapp.net`
    else if (typeof principal === 'string') jid = principal
  }

  if (!jid || !JID_DE_PESSOA.test(jid)) return null
  return jid.replace(/:\d+@/, '@')
}

function jidsDe(lista: unknown): string[] {
  if (!Array.isArray(lista)) return []
  return lista.map(paraJidDePessoa).filter((j): j is string => j !== null)
}

/**
 * Quem entrou, e em qual grupo — ou null se o evento não diz isso INEQUIVOCAMENTE.
 */
export function extrairEntradas(raw: unknown): EntradaEmGrupo | null {
  const todas = raizes(raw)
  if (todas.length === 0) return null

  const grupo = acharGrupo(todas)
  if (!grupo) return null

  const entraram = new Set<string>()

  for (const r of todas) {
    // Forma 1: listas explícitas de quem entrou (`Join: [...]`).
    for (const k of CHAVES_DE_ENTRADA) for (const j of jidsDe(r[k])) entraram.add(j)

    // Forma 2: uma ação de entrada + a lista de participantes.
    const acao = CHAVES_DA_ACAO.map((k) => r[k]).find((v): v is string => typeof v === 'string')
    if (acao && ACAO_DE_ENTRADA.test(acao) && !ACAO_QUE_NAO_E_ENTRADA.test(acao)) {
      for (const k of CHAVES_DE_PARTICIPANTES) for (const j of jidsDe(r[k])) entraram.add(j)
    }
  }

  return entraram.size > 0 ? { grupo, participantes: [...entraram] } : null
}

/** Só dígitos do número do dono da instância (`owner`), para nunca dar boas-vindas a si mesmo. */
export function numeroDoDono(raw: unknown): string | null {
  if (!ehObjeto(raw) || typeof raw.owner !== 'string') return null
  const d = raw.owner.replace(/\D/g, '')
  return d.length >= 8 ? d : null
}
