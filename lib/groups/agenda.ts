import { z } from 'zod'

import { avaliarAlvosEEspacamento, type GrupoConhecido, type Veredito } from './dispatch'
import { validarDescricaoDoGrupo, validarNomeDoGrupo } from './gestao'
import { ESPACAMENTO_MINIMO_S } from './limits'
import { ehTipoDeEnvio, validarConteudo } from './payloads'

/**
 * As regras do que pode ser AGENDADO, sem tocar em banco nem em rede.
 *
 * O envio pelo navegador (`dispatch.ts`) e o agendado compartilham as travas de
 * alvos, teto de marcar-todos e espaçamento (`avaliarAlvosEEspacamento`). O que
 * este arquivo acrescenta é o que só existe quando ninguém está olhando: datas,
 * e a recusa de agendar algo que o número já não poderia fazer hoje.
 */

/** Passos que o agendador sabe executar. Os demais tipos do banco ficam para depois. */
export const TIPOS_AGENDAVEIS = [
  'send_text', 'send_media', 'send_buttons',
  'update_name', 'update_description', 'update_image',
] as const
export type TipoAgendavel = (typeof TIPOS_AGENDAVEIS)[number]

export function ehTipoAgendavel(kind: string): kind is TipoAgendavel {
  return (TIPOS_AGENDAVEIS as readonly string[]).includes(kind)
}

/** Alterações exigem admin; envios exigem poder falar no grupo. */
export const ehAlteracao = (kind: string) => kind.startsWith('update_')

/** Teto de alvos de uma tarefa agendada. Folgado: o uso real é de ~10 grupos. */
export const MAX_GRUPOS_AGENDADOS = 100

/** Um agendamento "para daqui a 10 segundos" é um envio imediato disfarçado, sem as travas da tela. */
export const ANTECEDENCIA_MINIMA_MS = 60_000

export const HORIZONTE_MAXIMO_DIAS = 365

/** Quantas datas um passo aceita. A tela da fase 3 usa uma; o modelo já comporta várias. */
export const MAX_DATAS_POR_PASSO = 30

/** Folga entre o fim de uma ocorrência e o início da seguinte do mesmo passo. */
const FOLGA_ENTRE_OCORRENCIAS_MS = 60_000

/** Ocorrência atrasada além disso vira "perdeu o horário" (espelha a migration 016). */
export const TOLERANCIA_DE_ATRASO_MIN = 60

// ─────────────────────────────────────────────────────────────────────────────
// Conteúdo das alterações
// ─────────────────────────────────────────────────────────────────────────────

const payloadNome = z.object({ name: z.string() })
const payloadDescricao = z.object({ description: z.string() })
const payloadImagem = z.object({ image: z.string().trim().min(1) })

export type PayloadAgendavel =
  | { kind: 'send_text' | 'send_media' | 'send_buttons'; payload: Record<string, unknown> }
  | { kind: 'update_name'; payload: { name: string } }
  | { kind: 'update_description'; payload: { description: string } }
  | { kind: 'update_image'; payload: { image: string } }

export type ConteudoAgendavel = Veredito<{ conteudo: PayloadAgendavel }>

const recusa = (erro: string): { ok: false; status: number; erro: string; marcadores: Record<string, unknown> } =>
  ({ ok: false, status: 400, erro, marcadores: { conteudoInvalido: true } })

/**
 * Valida o conteúdo de UM passo e devolve a versão limpa dele.
 * `prefixoDeImagem` é a URL do bucket do painel: foto de grupo só vem de lá, para
 * a uazapiGO nunca ser mandada buscar um endereço qualquer.
 */
export function validarPassoAgendavel(
  kind: unknown,
  payload: unknown,
  prefixoDeImagem: string | null
): ConteudoAgendavel {
  if (typeof kind !== 'string' || !ehTipoAgendavel(kind)) {
    return recusa('Este tipo de ação ainda não pode ser agendado.')
  }

  if (ehTipoDeEnvio(kind)) {
    const r = validarConteudo(kind, payload)
    if (!r.ok) return recusa(r.erro)
    return { ok: true, conteudo: { kind, payload: r.conteudo.payload as Record<string, unknown> } }
  }

  switch (kind) {
    case 'update_name': {
      const p = payloadNome.safeParse(payload)
      if (!p.success) return recusa('Informe o novo nome do grupo.')
      const v = validarNomeDoGrupo(p.data.name)
      return v.ok ? { ok: true, conteudo: { kind, payload: { name: v.valor } } } : recusa(v.erro)
    }

    case 'update_description': {
      const p = payloadDescricao.safeParse(payload)
      if (!p.success) return recusa('Informe a nova descrição.')
      const v = validarDescricaoDoGrupo(p.data.description)
      return v.ok ? { ok: true, conteudo: { kind, payload: { description: v.valor } } } : recusa(v.erro)
    }

    case 'update_image': {
      const p = payloadImagem.safeParse(payload)
      if (!p.success) return recusa('Informe a imagem.')
      const imagem = p.data.image
      if (imagem !== 'remove' && (!prefixoDeImagem || !imagem.startsWith(prefixoDeImagem))) {
        return recusa('A imagem precisa ter sido enviada pelo painel.')
      }
      return { ok: true, conteudo: { kind, payload: { image: imagem } } }
    }
  }

  return recusa('Este tipo de ação ainda não pode ser agendado.')
}

// ─────────────────────────────────────────────────────────────────────────────
// Datas
// ─────────────────────────────────────────────────────────────────────────────

type Erro = { ok: false; status: number; erro: string; marcadores?: Record<string, unknown> }

const erro = (status: number, mensagem: string, marcadores?: Record<string, unknown>): Erro =>
  ({ ok: false, status, erro: mensagem, ...(marcadores ? { marcadores } : {}) })

/** Passos e ocorrências por agendamento: folga de sobra para o uso real, teto para não virar abuso. */
export const MAX_PASSOS = 10
export const MAX_OCORRENCIAS_POR_AGENDAMENTO = 60

/** Atraso relativo máximo: o horizonte inteiro, em minutos. */
export const MAX_ATRASO_RELATIVO_MIN = HORIZONTE_MAXIMO_DIAS * 24 * 60

export type DatasValidadas = Veredito<{ datas: string[] }>

/**
 * Lê as datas de UM passo: ISO com fuso, sem repetição, em ordem.
 * Só a forma — janela e sobreposição são conferidas depois, sobre o conjunto.
 */
function lerInstantes(brutas: unknown): { ok: true; instantes: number[] } | Erro {
  if (!Array.isArray(brutas) || brutas.length === 0) {
    return erro(400, 'Escolha a data e a hora do envio.')
  }
  if (brutas.length > MAX_DATAS_POR_PASSO) {
    return erro(400, `Um passo aceita até ${MAX_DATAS_POR_PASSO} datas.`)
  }

  const instantes: number[] = []
  for (const bruta of brutas) {
    // Só ISO com fuso explícito: "2026-10-25T14:00" sem fuso seria lido no fuso do SERVIDOR,
    // que não é o de quem agendou.
    if (typeof bruta !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(bruta)) {
      return erro(400, 'A data precisa vir com fuso horário.')
    }
    const t = Date.parse(bruta)
    if (Number.isNaN(t)) return erro(400, 'Uma das datas é inválida.')
    instantes.push(t)
  }

  return { ok: true, instantes: [...new Set(instantes)].sort((a, b) => a - b) }
}

/** Futuro com antecedência mínima e dentro do horizonte. `instantes` já vem ordenado. */
function conferirJanela(instantes: number[], agora: number): Erro | null {
  if (instantes[0] < agora + ANTECEDENCIA_MINIMA_MS) {
    return erro(
      400,
      'Agende com pelo menos 1 minuto de antecedência. Para enviar agora, use o envio direto.',
      { dataNoPassado: true }
    )
  }
  if (instantes[instantes.length - 1] > agora + HORIZONTE_MAXIMO_DIAS * 86_400_000) {
    return erro(400, `A data pode ser no máximo ${HORIZONTE_MAXIMO_DIAS} dias à frente.`)
  }
  return null
}

/** Quanto leva para percorrer os grupos: o que uma ocorrência ocupa do relógio. */
export const duracaoDaOcorrenciaMs = (quantidadeDeGrupos: number, espacamentoS: number) =>
  Math.max(0, quantidadeDeGrupos - 1) * Math.max(espacamentoS, ESPACAMENTO_MINIMO_S) * 1000

/**
 * Duas ocorrências só podem se sobrepor se a primeira ainda estiver enviando
 * quando a segunda começa. A cadência por número impede o ritmo de dobrar, mas a
 * tarefa ficaria correndo atrás do próprio rabo — então a rota recusa em vez de
 * aceitar uma agenda que não cabe. `instantes` ordenado, repetições incluídas.
 */
function conferirSobreposicao(instantes: number[], duracaoMs: number): Erro | null {
  for (let i = 1; i < instantes.length; i++) {
    if (instantes[i] - instantes[i - 1] < duracaoMs + FOLGA_ENTRE_OCORRENCIAS_MS) {
      return erro(
        400,
        'As datas estão juntas demais: cada envio leva cerca de ' +
          `${Math.ceil(duracaoMs / 60_000)} min para percorrer os grupos. Afaste as datas.`,
        { datasMuitoJuntas: true, duracaoMs }
      )
    }
  }
  return null
}

/** Valida as datas de um passo sozinho (a tela usa para dar o motivo na hora). */
export function validarDatas(
  brutas: unknown,
  quantidadeDeGrupos: number,
  espacamentoS: number,
  agora: number = Date.now()
): DatasValidadas {
  const lidas = lerInstantes(brutas)
  if (!lidas.ok) return lidas

  const janela = conferirJanela(lidas.instantes, agora)
  if (janela) return janela

  const folga = conferirSobreposicao(lidas.instantes, duracaoDaOcorrenciaMs(quantidadeDeGrupos, espacamentoS))
  if (folga) return folga

  return { ok: true, datas: lidas.instantes.map((t) => new Date(t).toISOString()) }
}

// ─────────────────────────────────────────────────────────────────────────────
// O pedido inteiro
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Um passo do pedido: o que fazer e QUANDO — ou em datas fixas (`datas`) ou
 * `offsetMinutos` depois da primeira data do primeiro passo (sequência).
 */
export interface PassoPedido {
  kind: unknown
  payload: unknown
  datas?: unknown
  offsetMinutos?: unknown
}

export interface PedidoDeAgendamento {
  name: unknown
  targetJids: unknown
  /** Vários passos. Se ausente, vale o formato de um passo só (`kind`/`payload`/`datas`). */
  passos?: unknown
  kind?: unknown
  payload?: unknown
  datas?: unknown
  marcarTodos: unknown
  espacamentoS: unknown
  jitterPct: unknown
}

export interface PassoAprovado {
  conteudo: PayloadAgendavel
  modo: 'absolute' | 'offset'
  /** As ocorrências já resolvidas, em ISO UTC e ordem. Passo com atraso relativo tem uma só. */
  datas: string[]
  offsetMinutos: number | null
}

export interface AgendamentoAprovado {
  nome: string
  passos: PassoAprovado[]
  targetJids: string[]
  marcarTodos: boolean
  espacamentoS: number
  jitterPct: number
  /** Âncora da sequência: a primeira data do primeiro passo. */
  inicio: string
}

const ehObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function avaliarAgendamento(
  pedido: PedidoDeAgendamento,
  grupos: Map<string, GrupoConhecido>,
  prefixoDeImagem: string | null,
  agora: number = Date.now()
): Veredito<{ aprovado: AgendamentoAprovado }> {
  // ── Os passos ──────────────────────────────────────────────────────────────
  const brutos: unknown[] = Array.isArray(pedido.passos)
    ? pedido.passos
    : [{ kind: pedido.kind, payload: pedido.payload, datas: pedido.datas }]

  if (brutos.length === 0) return erro(400, 'Inclua pelo menos um passo.')
  if (brutos.length > MAX_PASSOS) return erro(400, `Um agendamento aceita até ${MAX_PASSOS} passos.`)

  const prefixo = (i: number) => (brutos.length > 1 ? `Passo ${i + 1}: ` : '')

  const conteudos: PayloadAgendavel[] = []
  for (const [i, bruto] of brutos.entries()) {
    if (!ehObjeto(bruto)) return erro(400, `${prefixo(i)}passo inválido.`)

    const c = validarPassoAgendavel(bruto.kind, bruto.payload, prefixoDeImagem)
    if (!c.ok) return { ...c, erro: `${prefixo(i)}${c.erro}` }
    conteudos.push(c.conteudo)
  }

  const temMensagem = conteudos.some((c) => !ehAlteracao(c.kind))
  const temAlteracao = conteudos.some((c) => ehAlteracao(c.kind))

  // Marcar todos só faz sentido em mensagem. Numa alteração seria ignorado pela
  // uazapiGO, mas aceitar o campo esconderia um pedido sem sentido.
  if (!temMensagem && pedido.marcarTodos === true) return erro(400, 'Marcar todos só vale para mensagens.')

  // ── Os alvos e o ritmo ─────────────────────────────────────────────────────
  const alvos = avaliarAlvosEEspacamento(pedido, grupos, {
    maxGrupos: MAX_GRUPOS_AGENDADOS,
    mensagemDeExcesso: `Um agendamento aceita até ${MAX_GRUPOS_AGENDADOS} grupos.`,
    exige: temMensagem && temAlteracao ? 'ambos' : temAlteracao ? 'admin' : 'enviar',
  })
  if (!alvos.ok) return alvos

  // ── Quando: o primeiro passo ancora, os demais podem ser relativos ─────────
  const primeiro = brutos[0] as Record<string, unknown>
  if (primeiro.offsetMinutos !== undefined && primeiro.offsetMinutos !== null) {
    return erro(400, 'O primeiro passo precisa de uma data fixa: é ele que marca o início da sequência.')
  }

  const lidasDoPrimeiro = lerInstantes(primeiro.datas)
  if (!lidasDoPrimeiro.ok) return { ...lidasDoPrimeiro, erro: `${prefixo(0)}${lidasDoPrimeiro.erro}` }
  const ancora = lidasDoPrimeiro.instantes[0]

  const instantesPorPasso: number[][] = [lidasDoPrimeiro.instantes]
  const atrasos: (number | null)[] = [null]

  for (const [i, bruto] of brutos.entries()) {
    if (i === 0) continue
    const passo = bruto as Record<string, unknown>
    const temDatas = passo.datas !== undefined && passo.datas !== null
    const temAtraso = passo.offsetMinutos !== undefined && passo.offsetMinutos !== null

    if (temDatas && temAtraso) return erro(400, `${prefixo(i)}use datas fixas OU um atraso, não os dois.`)

    if (temAtraso) {
      const min = passo.offsetMinutos
      if (typeof min !== 'number' || !Number.isInteger(min) || min < 0 || min > MAX_ATRASO_RELATIVO_MIN) {
        return erro(400, `${prefixo(i)}o atraso precisa ser um número inteiro de minutos, de 0 a ${MAX_ATRASO_RELATIVO_MIN}.`)
      }
      instantesPorPasso.push([ancora + min * 60_000])
      atrasos.push(min)
      continue
    }

    const lidas = lerInstantes(passo.datas)
    if (!lidas.ok) {
      return {
        ...lidas,
        erro: lidas.erro === 'Escolha a data e a hora do envio.'
          ? `${prefixo(i)}escolha quando fazer.`
          : `${prefixo(i)}${lidas.erro}`,
      }
    }
    instantesPorPasso.push(lidas.instantes)
    atrasos.push(null)
  }

  const todos = instantesPorPasso.flat().sort((a, b) => a - b)

  if (todos.length > MAX_OCORRENCIAS_POR_AGENDAMENTO) {
    return erro(400, `Um agendamento aceita até ${MAX_OCORRENCIAS_POR_AGENDAMENTO} execuções no total (são ${todos.length}).`)
  }

  const janela = conferirJanela(todos, agora)
  if (janela) return janela

  // Sobreposição sobre o CONJUNTO: passos diferentes na mesma hora também disputam o número.
  const folga = conferirSobreposicao(
    todos,
    duracaoDaOcorrenciaMs(alvos.aprovado.targetJids.length, alvos.aprovado.espacamentoS)
  )
  if (folga) return folga

  const nome = typeof pedido.name === 'string' ? pedido.name.trim().slice(0, 120) : ''
  if (!nome) return erro(400, 'Dê um nome ao agendamento.')

  return {
    ok: true,
    aprovado: {
      nome,
      passos: conteudos.map((conteudo, i) => ({
        conteudo,
        modo: atrasos[i] === null ? 'absolute' : 'offset',
        datas: instantesPorPasso[i].map((t) => new Date(t).toISOString()),
        offsetMinutos: atrasos[i],
      })),
      ...alvos.aprovado,
      inicio: new Date(ancora).toISOString(),
    },
  }
}

/** Confirmação digitada: marcar todos em vários grupos, ou qualquer alteração em mais de um grupo. */
export function exigeConfirmacaoDoAgendamento(
  kinds: readonly string[],
  marcarTodos: boolean,
  quantidadeDeGrupos: number
): boolean {
  if (kinds.some(ehAlteracao) && quantidadeDeGrupos > 1) return true
  return marcarTodos && kinds.some((k) => !ehAlteracao(k)) && quantidadeDeGrupos > 3
}
