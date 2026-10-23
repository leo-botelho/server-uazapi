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

export type DatasValidadas = Veredito<{ datas: string[] }>

/**
 * Valida as datas de um passo: ISO válido, no futuro (com antecedência mínima),
 * dentro do horizonte, sem repetição — e SEM sobreposição.
 *
 * Duas ocorrências do mesmo passo só podem se sobrepor se a primeira ainda
 * estiver enviando quando a segunda começa. A cadência por número impede o ritmo
 * de dobrar, mas a tarefa ficaria correndo atrás do próprio rabo, então a rota
 * recusa em vez de aceitar uma agenda que não cabe.
 */
export function validarDatas(
  brutas: unknown,
  quantidadeDeGrupos: number,
  espacamentoS: number,
  agora: number = Date.now()
): DatasValidadas {
  const erro = (status: number, mensagem: string, marcadores?: Record<string, unknown>) =>
    ({ ok: false as const, status, erro: mensagem, ...(marcadores ? { marcadores } : {}) })

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

  const unicos = [...new Set(instantes)].sort((a, b) => a - b)

  if (unicos[0] < agora + ANTECEDENCIA_MINIMA_MS) {
    return erro(
      400,
      'Agende com pelo menos 1 minuto de antecedência. Para enviar agora, use o envio direto.',
      { dataNoPassado: true }
    )
  }
  if (unicos[unicos.length - 1] > agora + HORIZONTE_MAXIMO_DIAS * 86_400_000) {
    return erro(400, `A data pode ser no máximo ${HORIZONTE_MAXIMO_DIAS} dias à frente.`)
  }

  const duracaoMs = Math.max(0, quantidadeDeGrupos - 1) * Math.max(espacamentoS, ESPACAMENTO_MINIMO_S) * 1000
  for (let i = 1; i < unicos.length; i++) {
    if (unicos[i] - unicos[i - 1] < duracaoMs + FOLGA_ENTRE_OCORRENCIAS_MS) {
      return erro(
        400,
        'As datas estão juntas demais: cada envio leva cerca de ' +
          `${Math.ceil(duracaoMs / 60_000)} min para percorrer os grupos. Afaste as datas.`,
        { datasMuitoJuntas: true, duracaoMs }
      )
    }
  }

  return { ok: true, datas: unicos.map((t) => new Date(t).toISOString()) }
}

// ─────────────────────────────────────────────────────────────────────────────
// O pedido inteiro
// ─────────────────────────────────────────────────────────────────────────────

export interface PedidoDeAgendamento {
  name: unknown
  targetJids: unknown
  kind: unknown
  payload: unknown
  datas: unknown
  marcarTodos: unknown
  espacamentoS: unknown
  jitterPct: unknown
}

export interface AgendamentoAprovado {
  nome: string
  conteudo: PayloadAgendavel
  targetJids: string[]
  marcarTodos: boolean
  espacamentoS: number
  jitterPct: number
  datas: string[]
}

export function avaliarAgendamento(
  pedido: PedidoDeAgendamento,
  grupos: Map<string, GrupoConhecido>,
  prefixoDeImagem: string | null,
  agora: number = Date.now()
): Veredito<{ aprovado: AgendamentoAprovado }> {
  const conteudo = validarPassoAgendavel(pedido.kind, pedido.payload, prefixoDeImagem)
  if (!conteudo.ok) return conteudo

  const alteracao = ehAlteracao(conteudo.conteudo.kind)

  // Marcar todos só faz sentido em mensagem. Numa alteração seria ignorado pela
  // uazapiGO, mas aceitar o campo esconderia um pedido sem sentido.
  if (alteracao && pedido.marcarTodos === true) {
    return { ok: false, status: 400, erro: 'Marcar todos só vale para mensagens.' }
  }

  const alvos = avaliarAlvosEEspacamento(pedido, grupos, {
    maxGrupos: MAX_GRUPOS_AGENDADOS,
    mensagemDeExcesso: `Um agendamento aceita até ${MAX_GRUPOS_AGENDADOS} grupos.`,
    exige: alteracao ? 'admin' : 'enviar',
  })
  if (!alvos.ok) return alvos

  const datas = validarDatas(pedido.datas, alvos.aprovado.targetJids.length, alvos.aprovado.espacamentoS, agora)
  if (!datas.ok) return datas

  const nome = typeof pedido.name === 'string' ? pedido.name.trim().slice(0, 120) : ''
  if (!nome) return { ok: false, status: 400, erro: 'Dê um nome ao agendamento.' }

  return {
    ok: true,
    aprovado: { nome, conteudo: conteudo.conteudo, ...alvos.aprovado, datas: datas.datas },
  }
}

/** Confirmação digitada: marcar todos em vários grupos, ou qualquer alteração em mais de um grupo. */
export function exigeConfirmacaoDoAgendamento(
  kind: string,
  marcarTodos: boolean,
  quantidadeDeGrupos: number
): boolean {
  if (ehAlteracao(kind)) return quantidadeDeGrupos > 1
  return marcarTodos && quantidadeDeGrupos > 3
}
