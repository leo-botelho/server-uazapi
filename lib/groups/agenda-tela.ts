import { MAX_ATRASO_RELATIVO_MIN } from './agenda'
import { validarDescricaoDoGrupo, validarNomeDoGrupo } from './gestao'
import { RASCUNHO_VAZIO, rascunhoParaEnvio, resumoDoRascunho, validarRascunho, type RascunhoDaMensagem } from './rascunho'

/**
 * O que a tela de agendamento guarda por passo, e como isso vira o pedido da API.
 *
 * Fica fora do componente para ser testável: é aqui que "o que a pessoa digitou"
 * vira (ou não vira) um passo válido, e um erro aqui seria um agendamento errado
 * saindo dias depois, sem a tela para avisar.
 *
 * Só conferências de COMPLETUDE e forma. As regras de verdade (admin, teto de
 * marcar-todos, janela de datas, sobreposição) são de `avaliarAgendamento`, que a
 * tela chama com o pedido montado — uma regra só, em vez de duas copiadas.
 */

export type AcaoAgendada = 'mensagem' | 'nome' | 'descricao' | 'foto'

export const ROTULO_DA_ACAO: Record<AcaoAgendada, string> = {
  mensagem: 'Enviar mensagem',
  nome: 'Trocar o nome',
  descricao: 'Trocar a descrição',
  foto: 'Trocar a foto',
}

export type UnidadeDeAtraso = 'min' | 'h' | 'd'

export const MINUTOS_POR_UNIDADE: Record<UnidadeDeAtraso, number> = { min: 1, h: 60, d: 1440 }

export const ROTULO_DA_UNIDADE: Record<UnidadeDeAtraso, string> = { min: 'minutos', h: 'horas', d: 'dias' }

/** A pausa entre passos aceita segundos: o agendador junta passos próximos numa passada só. */
export type UnidadeDaPausa = 's' | UnidadeDeAtraso

export const SEGUNDOS_POR_UNIDADE: Record<UnidadeDaPausa, number> = { s: 1, min: 60, h: 3600, d: 86_400 }

export const ROTULO_DA_UNIDADE_DA_PAUSA: Record<UnidadeDaPausa, string> = {
  s: 'segundos', min: 'minutos', h: 'horas', d: 'dias',
}

export interface PassoDaTela {
  /** Identidade estável na lista (a posição muda quando um passo é removido). */
  chave: string
  acao: AcaoAgendada
  rascunho: RascunhoDaMensagem
  novoNome: string
  novaDescricao: string
  /** URL da foto já guardada no bucket. */
  fotoUrl: string | null

  /**
   * `datas`: dias e horas fixos. `depois`: um atraso a partir do início da sequência.
   * `apos`: logo depois que o passo ANTERIOR termina, com uma pausa.
   */
  quando: 'datas' | 'depois' | 'apos'
  /** ISO em UTC; null enquanto a pessoa não escolheu. */
  datas: (string | null)[]
  atraso: number | ''
  unidade: UnidadeDeAtraso
  /** Pausa depois do passo anterior (`apos`). Vazio = o mínimo (o ritmo do número). */
  pausa: number | ''
  unidadeDaPausa: UnidadeDaPausa
}

let contador = 0
export const novaChave = () => `passo-${++contador}`

/** Passo novo. Do segundo em diante o natural é "logo depois do anterior", não uma data. */
export function passoVazio(quando: 'datas' | 'apos' = 'datas'): PassoDaTela {
  return {
    chave: novaChave(),
    acao: 'mensagem',
    rascunho: RASCUNHO_VAZIO,
    novoNome: '',
    novaDescricao: '',
    fotoUrl: null,
    quando,
    datas: [null],
    atraso: '',
    unidade: 'd',
    pausa: '',
    unidadeDaPausa: 's',
  }
}

export const ehMensagem = (p: Pick<PassoDaTela, 'acao'>) => p.acao === 'mensagem'

export function kindDoPasso(p: PassoDaTela): string {
  switch (p.acao) {
    case 'nome': return 'update_name'
    case 'descricao': return 'update_description'
    case 'foto': return 'update_image'
    default: return rascunhoParaEnvio(p.rascunho).kind
  }
}

/** O atraso em minutos, ou null se ainda não está preenchido de forma válida. */
export function atrasoEmMinutos(p: Pick<PassoDaTela, 'atraso' | 'unidade'>): number | null {
  if (p.atraso === '' || !Number.isFinite(p.atraso) || !Number.isInteger(p.atraso) || p.atraso < 0) return null
  const minutos = p.atraso * MINUTOS_POR_UNIDADE[p.unidade]
  return minutos <= MAX_ATRASO_RELATIVO_MIN ? minutos : null
}

/**
 * A pausa em segundos, ou null se inválida. Vazio vale 0 = "o mínimo": quem fixa o
 * piso de verdade é o servidor (o ritmo do número), que a tela não precisa repetir.
 */
export function pausaEmSegundos(p: Pick<PassoDaTela, 'pausa' | 'unidadeDaPausa'>): number | null {
  if (p.pausa === '') return 0
  if (!Number.isFinite(p.pausa) || !Number.isInteger(p.pausa) || p.pausa < 0) return null
  const segundos = p.pausa * SEGUNDOS_POR_UNIDADE[p.unidadeDaPausa]
  return segundos <= MAX_ATRASO_RELATIVO_MIN * 60 ? segundos : null
}

/** O modo que vale para o passo: o primeiro sempre usa data fixa, é ele que ancora. */
export const quandoEfetivo = (p: Pick<PassoDaTela, 'quando'>, indice: number) => (indice === 0 ? 'datas' : p.quando)

/**
 * O que falta para este passo estar completo, ou null. `indice` 0 não pode ser
 * relativo: é ele que marca o início da sequência.
 */
export function motivoDoPasso(p: PassoDaTela, indice: number): string | null {
  switch (p.acao) {
    case 'mensagem': {
      const v = validarRascunho(p.rascunho)
      if (!v.ok) return v.erro
      break
    }
    case 'nome': {
      const v = validarNomeDoGrupo(p.novoNome)
      if (!v.ok) return v.erro
      break
    }
    case 'descricao': {
      const v = validarDescricaoDoGrupo(p.novaDescricao)
      if (!v.ok) return v.erro
      break
    }
    case 'foto':
      if (!p.fotoUrl) return 'escolha a nova foto.'
      break
  }

  const quando = quandoEfetivo(p, indice)

  if (quando === 'depois') {
    return atrasoEmMinutos(p) === null ? 'informe quanto tempo depois do início.' : null
  }
  if (quando === 'apos') {
    return pausaEmSegundos(p) === null ? 'a pausa depois do passo anterior é inválida (deixe vazio para o mínimo).' : null
  }

  if (p.datas.length === 0 || p.datas.some((d) => d === null)) return 'escolha a data e a hora.'
  return null
}

/** O passo no formato do corpo de `POST /api/groups/tasks`. */
export function passoParaApi(p: PassoDaTela, indice: number): Record<string, unknown> {
  const conteudo =
    p.acao === 'nome' ? { kind: 'update_name', payload: { name: p.novoNome } }
    : p.acao === 'descricao' ? { kind: 'update_description', payload: { description: p.novaDescricao } }
    : p.acao === 'foto' ? { kind: 'update_image', payload: { image: p.fotoUrl } }
    : (() => {
        const envio = rascunhoParaEnvio(p.rascunho)
        return { kind: envio.kind, payload: envio.payload as unknown as Record<string, unknown> }
      })()

  const quando = quandoEfetivo(p, indice)
  if (quando === 'depois') return { ...conteudo, offsetMinutos: atrasoEmMinutos(p) }
  if (quando === 'apos') return { ...conteudo, aposAnteriorSeg: pausaEmSegundos(p) }
  return { ...conteudo, datas: p.datas.filter((d): d is string => d !== null) }
}

/** Uma linha para o passo, para o cronograma e a confirmação. */
export function resumoDoPasso(p: PassoDaTela): string {
  switch (p.acao) {
    case 'nome': return `Trocar o nome para “${p.novoNome.trim()}”`
    case 'descricao': return p.novaDescricao.trim() ? 'Trocar a descrição' : 'Apagar a descrição'
    case 'foto': return 'Trocar a foto'
    default: return resumoDoRascunho(p.rascunho)
  }
}
