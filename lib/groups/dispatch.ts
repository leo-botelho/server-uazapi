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

  // ── 2. Os alvos ────────────────────────────────────────────────────────────
  if (!Array.isArray(pedido.targetJids) || pedido.targetJids.length === 0) {
    return recusar(400, 'Selecione pelo menos um grupo.')
  }
  if (!pedido.targetJids.every(ehJidDeGrupo)) {
    return recusar(400, 'A seleção tem um identificador de grupo inválido.')
  }

  // Repetido na seleção viraria mensagem dobrada no mesmo grupo.
  const alvos = [...new Set(pedido.targetJids as string[])]

  if (alvos.length > MAX_GRUPOS_NO_NAVEGADOR) {
    return recusar(
      400,
      `O envio direto aceita até ${MAX_GRUPOS_NO_NAVEGADOR} grupos por vez. ` +
      'Para mais que isso, use o agendamento.',
      { grupoDemais: true, limite: MAX_GRUPOS_NO_NAVEGADOR }
    )
  }

  const marcarTodos = pedido.marcarTodos === true

  // ── 3. Marcar todos: o teto ────────────────────────────────────────────────
  if (marcarTodos && alvos.length > MAX_GRUPOS_MARCANDO_TODOS) {
    return recusar(
      409,
      `Marcando todos, o limite é de ${MAX_GRUPOS_MARCANDO_TODOS} grupos por execução ` +
      `(você selecionou ${alvos.length}). Marcar todos em muitos grupos é o que mais leva ao banimento do número.`,
      { tetoMarcarTodos: true, limite: MAX_GRUPOS_MARCANDO_TODOS, pedidos: alvos.length }
    )
  }

  // ── 4. O espaçamento: um piso, não uma sugestão ────────────────────────────
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

  // ── 5. Os grupos existem e podemos falar neles ─────────────────────────────
  const desconhecidos = alvos.filter((jid) => !grupos.has(jid))
  if (desconhecidos.length > 0) {
    return recusar(
      400,
      `${desconhecidos.length} grupo(s) da seleção não estão na lista. Atualize a lista de grupos e selecione de novo.`,
      { gruposDesconhecidos: desconhecidos }
    )
  }

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

  // ── 6. O pré-voo ───────────────────────────────────────────────────────────
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

  return {
    ok: true,
    aprovado: { conteudo: conteudo.conteudo, targetJids: alvos, marcarTodos, espacamentoS, jitterPct },
  }
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
