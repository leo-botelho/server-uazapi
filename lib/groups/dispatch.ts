import {
  CONFIRMAR_MARCAR_TODOS_ACIMA_DE,
  ESPACAMENTO_PADRAO_S,
  JITTER_PADRAO_PCT,
  MAX_GRUPOS_MARCANDO_TODOS,
  MAX_GRUPOS_NO_NAVEGADOR,
  esperaMinimaAceita,
  espacamentoMinimo,
  mensagemDeEspacamentoBaixo,
} from './limits'
import { validarConteudo, type ConteudoValidado } from './payloads'
import type { Bloqueio } from './preflight-regras'

/**
 * As decisões do envio, sem tocar em banco nem em rede.
 *
 * Separadas das rotas de propósito: são as regras que impedem um disparo ruim,
 * e regra que só dá para testar subindo servidor e banco acaba sem teste.
 * As rotas só buscam os dados, chamam estas funções e obedecem ao veredito.
 */

/** Um veredito de recusa: status HTTP, mensagem para a tela e marcadores para ela reagir. */
export interface Recusa {
  status: number
  erro: string
  /** Campos extras no estilo da casa (`espacamentoBaixo: true`, `tetoMarcarTodos: true`…). */
  marcadores?: Record<string, unknown>
}

export type Veredito<T> = ({ ok: true } & T) | ({ ok: false } & Recusa)

const recusar = (status: number, erro: string, marcadores?: Record<string, unknown>): { ok: false } & Recusa =>
  ({ ok: false, status, erro, ...(marcadores ? { marcadores } : {}) })

// ─────────────────────────────────────────────────────────────────────────────
// Iniciar uma execução
// ─────────────────────────────────────────────────────────────────────────────

export interface PedidoDeInicio {
  targetJids: unknown
  kind: unknown
  payload: unknown
  marcarTodos: unknown
  espacamentoS: unknown
  jitterPct: unknown
  /** Passar por cima do bloqueio por COTA. Nunca vale para a restrição do WhatsApp. */
  liberarCota: unknown
}

export interface GrupoConhecido {
  nome: string | null
  podeEnviar: boolean
  /** Só é usado por alterações (nome, descrição, foto), que exigem admin. */
  ehAdmin?: boolean
}

export interface AprovacaoDeInicio {
  conteudo: ConteudoValidado
  targetJids: string[]
  marcarTodos: boolean
  espacamentoS: number
  jitterPct: number
}

const ehJidDeGrupo = (v: unknown): v is string => typeof v === 'string' && /^[0-9-]+@g\.us$/.test(v)

/** Inteiro dentro de [min, max], ou o padrão quando o valor não veio. */
function inteiro(v: unknown, padrao: number): number | null {
  if (v === undefined || v === null || v === '') return padrao
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && Number.isInteger(n) ? n : null
}

export interface AlvosEEspacamento {
  targetJids: unknown
  marcarTodos: unknown
  espacamentoS: unknown
  jitterPct: unknown
}

export interface OpcoesDeAlvos {
  /** Quantos grupos a execução aceita, e o que dizer quando passa disso. */
  maxGrupos: number
  mensagemDeExcesso: string
  /** O que o número precisa poder fazer em cada grupo. */
  exige: 'enviar' | 'admin'
}

export interface AlvosAprovados {
  targetJids: string[]
  marcarTodos: boolean
  espacamentoS: number
  jitterPct: number
}

/**
 * Os alvos e o ritmo: o que vale igual para o envio pelo navegador e para o
 * agendado. Mora num lugar só para as duas portas terem as MESMAS travas — uma
 * regra de segurança copiada em dois arquivos acaba divergindo.
 */
export function avaliarAlvosEEspacamento(
  pedido: AlvosEEspacamento,
  grupos: Map<string, GrupoConhecido>,
  opcoes: OpcoesDeAlvos
): Veredito<{ aprovado: AlvosAprovados }> {
  // ── Os alvos ───────────────────────────────────────────────────────────────
  if (!Array.isArray(pedido.targetJids) || pedido.targetJids.length === 0) {
    return recusar(400, 'Selecione pelo menos um grupo.')
  }
  if (!pedido.targetJids.every(ehJidDeGrupo)) {
    return recusar(400, 'A seleção tem um identificador de grupo inválido.')
  }

  // Repetido na seleção viraria mensagem dobrada no mesmo grupo.
  const alvos = [...new Set(pedido.targetJids as string[])]

  if (alvos.length > opcoes.maxGrupos) {
    return recusar(400, opcoes.mensagemDeExcesso, { grupoDemais: true, limite: opcoes.maxGrupos })
  }

  const marcarTodos = pedido.marcarTodos === true

  // ── Marcar todos: o teto ───────────────────────────────────────────────────
  if (marcarTodos && alvos.length > MAX_GRUPOS_MARCANDO_TODOS) {
    return recusar(
      409,
      `Marcando todos, o limite é de ${MAX_GRUPOS_MARCANDO_TODOS} grupos por execução ` +
      `(você selecionou ${alvos.length}). Marcar todos em muitos grupos é o que mais leva ao banimento do número.`,
      { tetoMarcarTodos: true, limite: MAX_GRUPOS_MARCANDO_TODOS, pedidos: alvos.length }
    )
  }

  // ── O espaçamento: um piso, não uma sugestão ───────────────────────────────
  const espacamentoS = inteiro(pedido.espacamentoS, ESPACAMENTO_PADRAO_S)
  if (espacamentoS === null) return recusar(400, 'O intervalo entre grupos precisa ser um número inteiro de segundos.')

  if (espacamentoS < espacamentoMinimo(marcarTodos)) {
    return recusar(400, mensagemDeEspacamentoBaixo(marcarTodos), {
      espacamentoBaixo: true,
      minimo: espacamentoMinimo(marcarTodos),
    })
  }

  const jitterBruto = inteiro(pedido.jitterPct, JITTER_PADRAO_PCT)
  if (jitterBruto === null) return recusar(400, 'A variação do intervalo precisa ser um número inteiro.')
  // O banco só aceita 0–50 (`check` em group_tasks).
  const jitterPct = Math.min(50, Math.max(0, jitterBruto))

  // ── Os grupos existem e podemos agir neles ─────────────────────────────────
  const desconhecidos = alvos.filter((jid) => !grupos.has(jid))
  if (desconhecidos.length > 0) {
    return recusar(
      400,
      `${desconhecidos.length} grupo(s) da seleção não estão na lista. Atualize a lista de grupos e selecione de novo.`,
      { gruposDesconhecidos: desconhecidos }
    )
  }

  if (opcoes.exige === 'enviar') {
    const semPermissao = alvos.filter((jid) => !grupos.get(jid)?.podeEnviar)
    if (semPermissao.length > 0) {
      const nomes = semPermissao.map((jid) => grupos.get(jid)?.nome ?? jid)
      return recusar(
        400,
        `O número conectado não pode enviar mensagem em: ${nomes.join(', ')}. ` +
        'São grupos só de admin em que ele não é admin.',
        { semPermissaoDeEnvio: semPermissao }
      )
    }
  } else {
    const semAdmin = alvos.filter((jid) => grupos.get(jid)?.ehAdmin !== true)
    if (semAdmin.length > 0) {
      const nomes = semAdmin.map((jid) => grupos.get(jid)?.nome ?? jid)
      return recusar(
        403,
        `O número conectado não é admin em: ${nomes.join(', ')}. ` +
        'Só admin altera nome, descrição ou foto. Se acabou de virar admin, atualize a lista.',
        { notAdmin: true, semAdmin }
      )
    }
  }

  return { ok: true, aprovado: { targetJids: alvos, marcarTodos, espacamentoS, jitterPct } }
}

/**
 * Decide se uma execução pode começar.
 *
 * `grupos` é o que o cache sabe sobre os alvos (JID → nome e portão de envio);
 * `bloqueio` vem do pré-voo. A ordem das checagens importa: as mais baratas e
 * as que o operador consegue corrigir sozinho vêm primeiro.
 */
export function avaliarInicio(
  pedido: PedidoDeInicio,
  grupos: Map<string, GrupoConhecido>,
  bloqueio: Bloqueio | null,
  podeForcar: boolean
): Veredito<{ aprovado: AprovacaoDeInicio }> {
  // ── 1. O conteúdo ──────────────────────────────────────────────────────────
  if (typeof pedido.kind !== 'string') return recusar(400, 'Escolha o tipo de mensagem.')

  const conteudo = validarConteudo(pedido.kind, pedido.payload)
  if (!conteudo.ok) return recusar(400, conteudo.erro, { conteudoInvalido: true })

  // ── 2. Alvos, teto, ritmo e permissão ──────────────────────────────────────
  const alvos = avaliarAlvosEEspacamento(pedido, grupos, {
    maxGrupos: MAX_GRUPOS_NO_NAVEGADOR,
    mensagemDeExcesso:
      `O envio direto aceita até ${MAX_GRUPOS_NO_NAVEGADOR} grupos por vez. ` +
      'Para mais que isso, use o agendamento.',
    exige: 'enviar',
  })
  if (!alvos.ok) return alvos

  // ── 3. O pré-voo ───────────────────────────────────────────────────────────
  if (bloqueio) {
    const liberado = bloqueio.tipo === 'cota' && podeForcar && pedido.liberarCota === true
    if (!liberado) {
      return recusar(409, bloqueio.motivo, {
        bloqueado: true,
        tipoDeBloqueio: bloqueio.tipo,
        ...(bloqueio.ate ? { ate: bloqueio.ate } : {}),
        // Só a cota pode ser liberada pelo operador. A restrição do WhatsApp
        // e a instância desconectada nunca.
        podeLiberar: bloqueio.tipo === 'cota' && podeForcar,
      })
    }
  }

  return { ok: true, aprovado: { conteudo: conteudo.conteudo, ...alvos.aprovado } }
}

/** A tela pede confirmação digitada quando marcar todos atinge muitos grupos. */
export function exigeConfirmacaoDigitada(marcarTodos: boolean, quantidadeDeGrupos: number): boolean {
  return marcarTodos && quantidadeDeGrupos > CONFIRMAR_MARCAR_TODOS_ACIMA_DE
}

// ─────────────────────────────────────────────────────────────────────────────
// Enviar para UM grupo
// ─────────────────────────────────────────────────────────────────────────────

export interface ExecucaoEmAndamento {
  status: string
  jidsResolvidos: string[] | null
  ultimaAcaoEm: string | null
  espacamentoS: number
  jitterPct: number
}

export type SituacaoDoItem = 'nenhum' | 'ja_processado'

/**
 * Decide se este grupo pode receber o envio agora.
 *
 * É o que impede o navegador de ser a fronteira de segurança: mesmo que a aba
 * mande requisições rápidas demais, ou o mesmo grupo duas vezes, ou um grupo de
 * fora da seleção, a rota recusa.
 */
export function avaliarEnvioAoGrupo(
  execucao: ExecucaoEmAndamento,
  groupJid: string,
  situacao: SituacaoDoItem,
  podeEnviar: boolean,
  agora: number = Date.now()
): Veredito<{ limiteDeAcao: string }> {
  if (execucao.status !== 'running') {
    return recusar(409, 'Esta execução já foi encerrada.', { encerrada: true, status: execucao.status })
  }

  if (!execucao.jidsResolvidos?.includes(groupJid)) {
    return recusar(400, 'Este grupo não faz parte da seleção desta execução.')
  }

  if (situacao === 'ja_processado') {
    // Mensagem dobrada no mesmo grupo é o erro mais visível que existe.
    return recusar(409, 'Este grupo já foi processado nesta execução.', { jaProcessado: true })
  }

  if (!podeEnviar) {
    return recusar(403, 'O número conectado não pode enviar mensagem neste grupo.', { semPermissaoDeEnvio: true })
  }

  const minimo = esperaMinimaAceita(execucao.espacamentoS, execucao.jitterPct)
  const ultima = execucao.ultimaAcaoEm ? Date.parse(execucao.ultimaAcaoEm) : NaN

  if (!Number.isNaN(ultima)) {
    const decorrido = agora - ultima
    if (decorrido < minimo) {
      const faltam = minimo - decorrido
      return recusar(
        429,
        `Aguarde ${Math.ceil(faltam / 1000)} s antes do próximo grupo.`,
        { espacamentoNaoRespeitado: true, tentarDeNovoEmMs: Math.ceil(faltam) }
      )
    }
  }

  // O servidor só grava `last_action_at` se ainda estiver neste limite — é o que
  // torna a checagem atômica quando duas requisições chegam juntas.
  return { ok: true, limiteDeAcao: new Date(agora - minimo).toISOString() }
}
