import type { Participante } from './gestao'

/**
 * CSV para o Excel brasileiro.
 *
 * Três armadilhas, todas resolvidas aqui e testadas:
 *  1. O Excel em português usa `;` como separador de lista: um CSV com vírgula abre
 *     inteiro numa coluna só. Por isso `;` e um BOM UTF-8 (sem ele os acentos viram lixo).
 *  2. INJEÇÃO DE FÓRMULA: o nome de um grupo é digitado por qualquer participante. Uma
 *     célula que começa com `=`, `+`, `-` ou `@` é executada como fórmula ao abrir o arquivo
 *     (`=HYPERLINK(...)` e coisa pior). Essas células ganham um `'` na frente.
 *  3. Telefone com 13 dígitos vira notação científica (5,52E+12). Formatado com espaços e
 *     hífen, o Excel o trata como texto.
 */

export const SEPARADOR = ';'
const BOM = '﻿'

/** Células que o Excel interpretaria como fórmula. Tab e CR também, por uma questão de prefixo. */
const COMECA_COMO_FORMULA = /^[=+\-@\t\r]/

/** Uma célula pronta para o arquivo: neutraliza fórmula e aplica as aspas quando preciso. */
export function celula(valor: string | number | boolean | null | undefined): string {
  if (valor === null || valor === undefined) return ''

  let texto = typeof valor === 'boolean' ? (valor ? 'Sim' : 'Não') : String(valor)
  if (COMECA_COMO_FORMULA.test(texto)) texto = `'${texto}`

  return /[;"\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

/** O arquivo inteiro: BOM, cabeçalho e linhas, com quebra de linha do Windows. */
export function montarCsv(cabecalho: string[], linhas: (string | number | boolean | null | undefined)[][]): string {
  const todas = [cabecalho, ...linhas]
  return BOM + todas.map((l) => l.map(celula).join(SEPARADOR)).join('\r\n') + '\r\n'
}

/**
 * "55 21 98765-4321". Só formata o que reconhece como número brasileiro (55 + DDD + 8 ou 9
 * dígitos); o resto sai como veio. Sem dígitos, vazio.
 */
export function formatarTelefone(digitos: string | null | undefined): string {
  const d = (digitos ?? '').replace(/\D/g, '')
  if (!d) return ''

  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d)
  return m ? `55 ${m[1]} ${m[2]}-${m[3]}` : d
}

/** Data e hora de Brasília, para a coluna "atualizado em" e para o nome do arquivo. */
export function dataEmBrasilia(quando: Date | string | null | undefined): string {
  if (!quando) return ''
  const d = typeof quando === 'string' ? new Date(quando) : quando
  if (Number.isNaN(d.getTime())) return ''

  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(d)
}

/** `2026-10-24`, no fuso de Brasília — para nome de arquivo. */
export function diaParaArquivo(quando: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(quando)
  return partes
}

// ─────────────────────────────────────────────────────────────────────────────
// Os dois relatórios
// ─────────────────────────────────────────────────────────────────────────────

export interface GrupoParaExportar {
  group_jid: string
  name: string | null
  topic: string | null
  participant_count: number | null
  owner_is_admin: boolean
  owner_can_send: boolean
  is_announce: boolean | null
  is_locked: boolean | null
  is_parent: boolean | null
  fetched_at: string
}

export const CABECALHO_DE_GRUPOS = [
  'Nome', 'Participantes', 'O número é admin', 'O número pode enviar',
  'Só admins falam', 'Só admins editam', 'É comunidade', 'Descrição', 'ID do grupo', 'Atualizado em',
]

export function linhasDeGrupos(grupos: GrupoParaExportar[]) {
  return grupos.map((g) => [
    g.name ?? '', g.participant_count, g.owner_is_admin, g.owner_can_send,
    g.is_announce, g.is_locked, g.is_parent, g.topic ?? '', g.group_jid, dataEmBrasilia(g.fetched_at),
  ])
}

export const CABECALHO_DE_PARTICIPANTES = ['Grupo', 'Telefone', 'Nome', 'Admin', 'ID do grupo', 'ID do participante']

/**
 * As linhas de UM grupo. Em grupo no modo LID o WhatsApp esconde o telefone de quem não é
 * contato: a célula fica vazia em vez de receber o identificador opaco como se fosse número.
 */
export function linhasDeParticipantes(nomeDoGrupo: string, groupJid: string, participantes: Participante[]) {
  return participantes.map((p) => [
    nomeDoGrupo, formatarTelefone(p.telefone), p.nome ?? '', p.admin, groupJid, p.jid,
  ])
}
