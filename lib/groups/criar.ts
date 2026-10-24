import { linkDeConvite } from './deeplinks'
import { extrairTelefones, type Validado } from './gestao'
import type { UazapiGroup } from '@/lib/uazapi/group-types'

/**
 * Criar grupo, entrar por convite e gerenciar comunidades: as regras de entrada, sem rede nem
 * banco. A tela valida antes de mandar e a rota valida de novo — mesmos limites, num lugar só.
 *
 * Todas essas ações mexem com GENTE: criar um grupo adiciona pessoas, entrar por convite põe o
 * número num grupo que ele não conhece. São o tipo de ação que o WhatsApp mais associa a abuso.
 */

/** Criar um grupo aceita 100 caracteres no nome (renomear documenta 25 — ver gestao.ts). */
export const MAX_NOME_AO_CRIAR = 100

/** A spec limita a 50 participantes iniciais. */
export const MAX_PARTICIPANTES_AO_CRIAR = 50

export interface NovoGrupo {
  nome: string
  /** Telefones canônicos (com o 55), só dígitos, sem repetição. */
  participantes: string[]
  /** Trechos que pareciam número mas têm tamanho inválido. */
  ignorados: string[]
}

/** Conta pontos de código, não unidades UTF-16: um emoji vale um caractere. */
const tamanho = (t: string) => [...t].length

export function validarNovoGrupo(nomeBruto: unknown, telefonesBrutos: unknown): Validado<NovoGrupo> {
  if (typeof nomeBruto !== 'string') return { ok: false, erro: 'Informe o nome do grupo.' }

  const nome = nomeBruto.trim()
  if (!nome) return { ok: false, erro: 'O nome do grupo não pode ficar vazio.' }
  if (tamanho(nome) > MAX_NOME_AO_CRIAR) {
    return { ok: false, erro: `O nome do grupo aceita no máximo ${MAX_NOME_AO_CRIAR} caracteres.` }
  }

  if (typeof telefonesBrutos !== 'string' || !telefonesBrutos.trim()) {
    return { ok: false, erro: 'Informe pelo menos um telefone: um grupo precisa de alguém além de você.' }
  }

  const { numeros, ignorados } = extrairTelefones(telefonesBrutos)

  if (numeros.length === 0) {
    return { ok: false, erro: 'Não encontrei nenhum telefone válido na lista. Use DDD + número, um por linha.' }
  }
  if (numeros.length > MAX_PARTICIPANTES_AO_CRIAR) {
    return {
      ok: false,
      erro: `Um grupo novo aceita até ${MAX_PARTICIPANTES_AO_CRIAR} pessoas de início (você colou ${numeros.length}). ` +
        'Crie com as primeiras e envie o link de convite para o resto.',
    }
  }

  return { ok: true, valor: { nome, participantes: numeros, ignorados } }
}

/** O código de convite de uma URL ou código colado, ou o erro pronto para a tela. */
export function validarConvite(entrada: unknown): Validado<string> {
  if (typeof entrada !== 'string') return { ok: false, erro: 'Cole o link ou o código do convite.' }

  const r = linkDeConvite(entrada)
  if (!r.ok) return { ok: false, erro: r.erro }

  return { ok: true, valor: r.url.replace('https://chat.whatsapp.com/', '') }
}

// ─────────────────────────────────────────────────────────────────────────────
// Comunidades
// ─────────────────────────────────────────────────────────────────────────────

const ehJidDeGrupo = (v: unknown): v is string => typeof v === 'string' && /^[0-9-]+@g\.us$/.test(v)

/** A spec não documenta limite para o nome da comunidade: 100 é teto de sanidade (o de criar grupo). */
export function validarNomeDeComunidade(bruto: unknown): Validado<string> {
  if (typeof bruto !== 'string') return { ok: false, erro: 'Informe o nome da comunidade.' }
  const nome = bruto.trim()
  if (!nome) return { ok: false, erro: 'O nome da comunidade não pode ficar vazio.' }
  if (tamanho(nome) > MAX_NOME_AO_CRIAR) return { ok: false, erro: `O nome aceita no máximo ${MAX_NOME_AO_CRIAR} caracteres.` }
  return { ok: true, valor: nome }
}

/** Quantos grupos entram ou saem de uma comunidade por pedido. */
export const MAX_GRUPOS_POR_VINCULO = 20

export type AcaoDeVinculo = 'add' | 'remove'

export interface Vinculo {
  comunidade: string
  acao: AcaoDeVinculo
  grupos: string[]
}

export function validarVinculo(comunidade: unknown, acao: unknown, grupos: unknown): Validado<Vinculo> {
  if (!ehJidDeGrupo(comunidade)) return { ok: false, erro: 'Escolha a comunidade.' }
  if (acao !== 'add' && acao !== 'remove') return { ok: false, erro: 'Escolha vincular ou desvincular.' }

  if (!Array.isArray(grupos) || grupos.length === 0) return { ok: false, erro: 'Escolha pelo menos um grupo.' }
  if (!grupos.every(ehJidDeGrupo)) return { ok: false, erro: 'A seleção tem um identificador de grupo inválido.' }

  const unicos = [...new Set(grupos)]

  // A comunidade é, ela própria, um "grupo" na lista: vincular a comunidade a si mesma não faz sentido.
  if (unicos.includes(comunidade)) return { ok: false, erro: 'Uma comunidade não pode ser vinculada a ela mesma.' }

  if (unicos.length > MAX_GRUPOS_POR_VINCULO) {
    return { ok: false, erro: `Vincule até ${MAX_GRUPOS_POR_VINCULO} grupos por vez (você escolheu ${unicos.length}).` }
  }

  return { ok: true, valor: { comunidade, acao, grupos: unicos } }
}

/** Resume o resultado de `/community/editgroups` para a tela. */
export function resumirVinculo(
  acao: AcaoDeVinculo,
  pedidos: number,
  resposta: { success?: string[]; failed?: string[] }
): { feitos: number; falhas: number; mensagem: string } {
  const falhas = resposta.failed?.length ?? 0
  // Se a API não detalhar, `success` ausente significa "não sei": não inventa que tudo deu certo.
  const feitos = resposta.success !== undefined ? resposta.success.length : Math.max(0, pedidos - falhas)
  const base = acao === 'add' ? 'vinculado' : 'desvinculado'
  const verbo = (n: number) => (n === 1 ? base : `${base}s`)

  return {
    feitos,
    falhas,
    mensagem: falhas > 0
      ? `${feitos} ${verbo(feitos)}, ${falhas} ${falhas === 1 ? 'recusado' : 'recusados'} pelo WhatsApp.`
      : `${feitos} ${feitos === 1 ? 'grupo' : 'grupos'} ${verbo(feitos)}.`,
  }
}

/**
 * O grupo de uma resposta da uazapiGO. A spec documenta `create` e `inviteInfo` devolvendo o
 * `Group` direto, e `join` / `community/create` devolvendo `{ group }`. O cliente tipa tudo
 * como envelope, então aceitamos os DOIS formatos em vez de apostar em um: o que decide é
 * existir um `JID` de grupo.
 */
export function grupoDaResposta(resposta: unknown): UazapiGroup | undefined {
  if (typeof resposta !== 'object' || resposta === null) return undefined

  const direto = resposta as { JID?: unknown; group?: unknown }
  if (typeof direto.JID === 'string' && direto.JID.endsWith('@g.us')) return resposta as UazapiGroup

  const dentro = direto.group as { JID?: unknown } | undefined
  if (dentro && typeof dentro.JID === 'string' && dentro.JID.endsWith('@g.us')) return dentro as UazapiGroup

  return undefined
}
