import type { UazapiGroup, UazapiParticipantsResult } from '@/lib/uazapi/group-types'

/**
 * Regras da gestão de um grupo: validação do que a pessoa digita, leitura dos
 * participantes e o plano de remoção em massa.
 *
 * Tudo puro. A tela valida antes de mandar e a rota valida de novo — os mesmos
 * limites, no mesmo lugar, para não divergirem.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Limites (da spec do uazapiGO)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O que a spec da uazapiGO documenta para RENOMEAR: "entre 1 e 25 caracteres" (criar um
 * grupo documenta 100). É um AVISO, não uma trava: grupos criados com nomes longos existem,
 * então o WhatsApp aceita mais que isso, e bloquear aqui impediria renomear esses grupos.
 * Se a uazapiGO recusar, o erro volta traduzido na tela (ou no item, se estiver agendado).
 */
export const NOME_DOCUMENTADO_NA_SPEC = 25

/** Teto de segurança: o mesmo de criar um grupo. Acima disso nem tentamos. */
export const MAX_NOME_DO_GRUPO = 100

/**
 * Aviso para nomes acima do que a spec documenta, ou null. Conta pontos de código
 * (um emoji vale 1), como a validação.
 */
export function avisoDoNome(nome: string): string | null {
  const tamanho = [...nome.trim()].length
  if (tamanho <= NOME_DOCUMENTADO_NA_SPEC) return null
  return (
    `A uazapiGO documenta no máximo ${NOME_DOCUMENTADO_NA_SPEC} caracteres para renomear e este nome tem ${tamanho}. ` +
    'Grupos com nomes maiores existem, então pode funcionar — se for recusado, o erro aparece e nada é alterado. ' +
    'Vale testar num grupo antes de aplicar em vários.'
  )
}

/** Acima disso a API devolve 413. */
export const MAX_DESCRICAO_DO_GRUPO = 512

/**
 * Participantes por chamada de `updateParticipants`.
 *
 * ⚠️ A spec NÃO documenta o máximo (criar grupo limita a 50). 15 é prudência
 * minha, e remoção em massa também é sinal de comportamento automatizado para
 * o WhatsApp — por isso o lote é pequeno e há espera entre eles.
 */
export const LOTE_DE_PARTICIPANTES = 15

/** Segundos entre um lote de remoção e o seguinte. */
export const ESPERA_ENTRE_LOTES_S = 10

export type Validado<T> = { ok: true; valor: T } | { ok: false; erro: string }

export function validarNomeDoGrupo(bruto: unknown): Validado<string> {
  if (typeof bruto !== 'string') return { ok: false, erro: 'Informe o nome do grupo.' }

  const nome = bruto.trim()
  if (nome.length === 0) return { ok: false, erro: 'O nome do grupo não pode ficar vazio.' }

  // Conta pontos de código, não unidades UTF-16: um emoji é UM caractere para o WhatsApp.
  if ([...nome].length > MAX_NOME_DO_GRUPO) {
    return { ok: false, erro: `O WhatsApp aceita no máximo ${MAX_NOME_DO_GRUPO} caracteres no nome do grupo.` }
  }
  return { ok: true, valor: nome }
}

export function validarDescricaoDoGrupo(bruto: unknown): Validado<string> {
  if (typeof bruto !== 'string') return { ok: false, erro: 'Informe a descrição.' }

  // Vazia é válida: é como se APAGA a descrição.
  const descricao = bruto.trim()
  if ([...descricao].length > MAX_DESCRICAO_DO_GRUPO) {
    return { ok: false, erro: `A descrição passa de ${MAX_DESCRICAO_DO_GRUPO} caracteres.` }
  }
  return { ok: true, valor: descricao }
}

export type ConfiguracaoDoGrupo =
  | 'announce' | 'locked' | 'joinApproval' | 'memberAddMode' | 'ephemeral'

export type ValorDeConfiguracao = boolean | 'admin_add' | 'all_member_add' | 0 | '1d' | '7d' | '90d'

const TEMPORARIAS = [0, '1d', '7d', '90d'] as const

/**
 * Valida o valor de UMA configuração.
 * `ephemeral` aceita `'off'` por conveniência e normaliza para 0.
 */
export function validarConfiguracao(
  configuracao: unknown,
  valor: unknown
): Validado<{ configuracao: ConfiguracaoDoGrupo; valor: ValorDeConfiguracao }> {
  switch (configuracao) {
    case 'announce':
    case 'locked':
    case 'joinApproval':
      return typeof valor === 'boolean'
        ? { ok: true, valor: { configuracao, valor } }
        : { ok: false, erro: 'Esta configuração aceita ligado ou desligado.' }

    case 'memberAddMode':
      return valor === 'admin_add' || valor === 'all_member_add'
        ? { ok: true, valor: { configuracao, valor } }
        : { ok: false, erro: 'Escolha quem pode adicionar membros: só admins ou todos.' }

    case 'ephemeral': {
      const v = valor === 'off' ? 0 : valor
      return (TEMPORARIAS as readonly unknown[]).includes(v)
        ? { ok: true, valor: { configuracao, valor: v as ValorDeConfiguracao } }
        : { ok: false, erro: 'Mensagens temporárias aceitam: desligado, 1 dia, 7 dias ou 90 dias.' }
    }

    default:
      return { ok: false, erro: 'Configuração desconhecida.' }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Participantes
// ─────────────────────────────────────────────────────────────────────────────

export interface Participante {
  jid: string
  /** Só dígitos, ou null quando o WhatsApp não revela o número (grupo em modo LID). */
  telefone: string | null
  nome: string | null
  admin: boolean
  superAdmin: boolean
}

/** Só dígitos da parte antes do `@`, ou null se não houver. */
function digitosDoJid(jid: string | undefined): string | null {
  if (!jid) return null
  const parte = jid.split('@')[0]?.split(':')[0] ?? ''
  const digitos = parte.replace(/\D/g, '')
  return digitos.length >= 8 ? digitos : null
}

/**
 * Reduz a lista de participantes da API ao que a tela usa.
 *
 * O número vem de `PhoneNumber` quando existe. Em grupos que usam o endereçamento
 * `lid`, o JID é um identificador opaco e NÃO é um telefone — nesse caso, sem
 * `PhoneNumber`, o número simplesmente não é conhecido e fica null. Tratar o
 * identificador como telefone faria a remoção em massa casar com a pessoa errada.
 */
export function resumirParticipantes(grupo: Pick<UazapiGroup, 'Participants'>): Participante[] {
  return (grupo.Participants ?? []).map((p) => {
    const ehLid = p.JID.endsWith('@lid')

    return {
      jid: p.JID,
      telefone: digitosDoJid(p.PhoneNumber) ?? (ehLid ? null : digitosDoJid(p.JID)),
      nome: p.DisplayName?.trim() || null,
      admin: p.IsAdmin === true || p.IsSuperAdmin === true,
      superAdmin: p.IsSuperAdmin === true,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Lista de compradores → números
// ─────────────────────────────────────────────────────────────────────────────

export interface NumerosExtraidos {
  /** Números canônicos (com o 55), sem repetição. */
  numeros: string[]
  /** Trechos que pareciam número mas não servem (tamanho errado). */
  ignorados: string[]
}

/**
 * Extrai telefones de um texto colado (uma linha por pessoa, CSV, planilha).
 *
 * - Separa por quebra de linha, `;`, `,` e tabulação. Espaço NÃO separa: telefone
 *   costuma vir como "+55 21 99999-8888".
 * - Trecho com menos de 6 dígitos é nome ou lixo e some em silêncio.
 * - 10 ou 11 dígitos = número brasileiro sem DDI: ganha o 55. É suposição, e o
 *   público deste painel é brasileiro.
 * - Um CPF tem 11 dígitos e entra como telefone. Não casa com ninguém e cai em
 *   "não encontrados" — inofensivo, e o operador vê.
 */
export function extrairTelefones(texto: string): NumerosExtraidos {
  const vistos = new Set<string>()
  const ignorados: string[] = []

  for (const trecho of texto.split(/[\n\r;,\t]+/)) {
    const digitos = trecho.replace(/\D/g, '')
    if (digitos.length < 6) continue

    let numero: string
    if (digitos.length === 10 || digitos.length === 11) {
      numero = `55${digitos}`
    } else if (digitos.length === 12 || digitos.length === 13) {
      numero = digitos
    } else {
      ignorados.push(trecho.trim())
      continue
    }

    vistos.add(numero)
  }

  return { numeros: [...vistos], ignorados }
}

/**
 * Formas equivalentes de um número brasileiro.
 *
 * O mesmo celular aparece com e sem o nono dígito dependendo de quando e por
 * onde o número foi cadastrado: 5521987654321 (13) e 552187654321 (12) são a
 * mesma pessoa. Casar só a forma digitada deixaria gente de fora da remoção.
 */
export function variantesBrasileiras(numero: string): string[] {
  if (numero.startsWith('55') && numero.length === 13 && numero[4] === '9') {
    return [numero, numero.slice(0, 4) + numero.slice(5)]
  }
  if (numero.startsWith('55') && numero.length === 12) {
    return [numero, `${numero.slice(0, 4)}9${numero.slice(4)}`]
  }
  return [numero]
}

export interface PlanoDeRemocao {
  /** Quem será removido (não-admins que casaram). */
  remover: Participante[]
  /** Casaram, mas são admin: ficam de fora. Remover um co-host por engano é o erro caro. */
  admins: Participante[]
  /** Estavam na lista e não foram achados no grupo. */
  naoEncontrados: string[]
  /** Participantes do grupo sem número visível — não dá para casar com a lista. */
  semNumeroVisivel: number
}

export function planejarRemocao(roster: Participante[], numeros: string[]): PlanoDeRemocao {
  const porTelefone = new Map<string, Participante>()
  for (const p of roster) if (p.telefone) porTelefone.set(p.telefone, p)

  const removerPorJid = new Map<string, Participante>()
  const adminsPorJid = new Map<string, Participante>()
  const naoEncontrados: string[] = []

  for (const numero of numeros) {
    const achado = variantesBrasileiras(numero)
      .map((v) => porTelefone.get(v))
      .find((p): p is Participante => p !== undefined)

    if (!achado) {
      naoEncontrados.push(numero)
    } else if (achado.admin) {
      adminsPorJid.set(achado.jid, achado)
    } else {
      removerPorJid.set(achado.jid, achado)
    }
  }

  return {
    remover: [...removerPorJid.values()],
    admins: [...adminsPorJid.values()],
    naoEncontrados,
    semNumeroVisivel: roster.filter((p) => !p.telefone).length,
  }
}

/** Divide em lotes de até `tamanho`. */
export function emLotes<T>(itens: T[], tamanho = LOTE_DE_PARTICIPANTES): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho))
  return lotes
}

export interface ResumoDoLote {
  sucessos: string[]
  falhas: { jid: string; codigo: number }[]
}

/** `groupUpdated[]`: `Error: 0` é sucesso para aquele participante. */
export function resumirResultadoDoLote(
  resposta: UazapiParticipantsResult,
  enviados: string[]
): ResumoDoLote {
  const atualizados = resposta.groupUpdated ?? []

  // Se a API não devolveu o detalhe por participante, não dá para afirmar nada
  // sobre cada um — considera falha desconhecida em vez de sucesso presumido.
  if (atualizados.length === 0) {
    return { sucessos: [], falhas: enviados.map((jid) => ({ jid, codigo: -1 })) }
  }

  return {
    sucessos: atualizados.filter((u) => u.Error === 0).map((u) => u.JID),
    falhas: atualizados.filter((u) => u.Error !== 0).map((u) => ({ jid: u.JID, codigo: u.Error })),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fila de aprovação de entrada
// ─────────────────────────────────────────────────────────────────────────────

export interface Solicitacao {
  /** EXATAMENTE como a uazapiGO devolveu: é o que se manda de volta ao aprovar ou rejeitar. */
  id: string
  /** Só dígitos, ou null quando o WhatsApp esconde o número (identificador `@lid`). */
  telefone: string | null
}

/**
 * Chave para comparar dois jeitos de escrever a mesma pessoa: sem sufixo de dispositivo, e
 * telefone puro igual ao JID dele. Minúsculas.
 */
export function chaveDaSolicitacao(id: string): string {
  const t = id.trim().toLowerCase().replace(/:\d+@/, '@')
  return /^\d+$/.test(t) ? `${t}@s.whatsapp.net` : t
}

/**
 * Lê `request_participants` — uma STRING separada por vírgula, não um array. Cada item pode
 * vir como JID ou como telefone; a leitura aceita os dois, sem repetição, e nunca lança.
 * Em `@lid` o identificador é opaco: não vira telefone (casaria a pessoa errada).
 */
export function lerSolicitacoes(bruto: unknown): Solicitacao[] {
  if (typeof bruto !== 'string') return []

  const vistos = new Set<string>()
  const lista: Solicitacao[] = []

  for (const parte of bruto.split(',')) {
    const id = parte.trim()
    if (!id) continue

    const chave = chaveDaSolicitacao(id)
    if (vistos.has(chave)) continue
    vistos.add(chave)

    const semDominio = id.split('@')[0]?.split(':')[0] ?? ''
    const digitos = semDominio.replace(/\D/g, '')
    const oculto = chave.endsWith('@lid')

    lista.push({ id, telefone: !oculto && digitos.length >= 8 ? digitos : null })
  }

  return lista
}

/**
 * Quais dos pedidos de ação ainda estão MESMO pendentes. Quem já foi aprovado por outro admin,
 * ou desistiu, vira `naoEstao` em vez de erro. `alvos` leva o `id` ORIGINAL da fila, não o que
 * veio no pedido: assim a API recebe exatamente o formato que ela mesma devolveu.
 */
export function planejarSolicitacoes(
  pendentes: Solicitacao[],
  pedidos: string[]
): { alvos: string[]; naoEstao: string[] } {
  const porChave = new Map(pendentes.map((p) => [chaveDaSolicitacao(p.id), p.id]))
  const alvos: string[] = []
  const naoEstao: string[] = []

  // Deduplica pela PESSOA (o id da fila), não pelo texto do pedido: três formas de escrever o
  // mesmo número seriam três alvos, e a API receberia a mesma pessoa repetida.
  const jaEscolhidos = new Set<string>()

  for (const pedido of new Set(pedidos)) {
    const original = porChave.get(chaveDaSolicitacao(pedido))

    if (!original) naoEstao.push(pedido)
    else if (!jaEscolhidos.has(original)) {
      jaEscolhidos.add(original)
      alvos.push(original)
    }
  }

  return { alvos, naoEstao }
}
