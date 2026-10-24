/**
 * Regras de segurança do módulo de grupos, num lugar só.
 *
 * A tela, as rotas e (a partir da fase 3) o agendador importam daqui. A mesma
 * regra repetida em três arquivos acaba divergindo, e a divergência aparece
 * justamente como a trava que existe na tela e não existe na rota.
 *
 * Os dois pisos de espaçamento também existem como `check` na migration 015
 * (`group_tasks`). Mudar um número aqui sem mudar lá faz o INSERT falhar com um
 * erro de constraint em vez de uma mensagem útil.
 */

/** Segundos mínimos entre um grupo e o próximo. */
export const ESPACAMENTO_MINIMO_S = 5

/**
 * Segundos mínimos quando a mensagem marca todos.
 *
 * Marcar todos em muitos grupos é a ação com maior risco de banimento do
 * número: cada menção notifica todos os participantes.
 */
export const ESPACAMENTO_MINIMO_MARCAR_TODOS_S = 60

/** Padrão sugerido na tela. Lento de propósito. */
export const ESPACAMENTO_PADRAO_S = 60

/** Variação aleatória aplicada ao espaçamento (±%). Cadência exata é assinatura de robô. */
export const JITTER_PADRAO_PCT = 20

/**
 * Quantos grupos o envio pelo navegador aceita.
 *
 * O navegador é quem espera entre um grupo e outro (grátis em CPU de Worker),
 * mas a aba precisa ficar aberta. Acima disso, o caminho certo é o agendador.
 */
export const MAX_GRUPOS_NO_NAVEGADOR = 20

/** Teto de grupos com marcar todos numa mesma execução. */
export const MAX_GRUPOS_MARCANDO_TODOS = 10

/** Acima disso, marcar todos exige digitar a quantidade para confirmar. */
export const CONFIRMAR_MARCAR_TODOS_ACIMA_DE = 3

/**
 * Atraso de "digitando…" em ms. O campo `delay` da uazapiGO é em MILISSEGUNDOS
 * (os de campanha, `delayMin`/`delayMax`, é que são em segundos).
 */
export const ATRASO_DIGITANDO_MS = 1800

/** Folga de relógio entre o navegador e o servidor ao conferir o espaçamento. */
export const TOLERANCIA_ESPACAMENTO_MS = 750

/**
 * O piso do intervalo. Marcando todos o padrão é 60 s — a não ser que a pessoa tenha ligado
 * o MODO AVANÇADO (`aceitouRisco`), caso em que vale o piso geral de 5 s. Os 60 s e o teto de
 * 10 grupos são recomendações minhas, não regras do WhatsApp: quem já opera com intervalo
 * curto e muitos grupos (o n8n do usuário, a 5 s) precisa poder, desde que confirme.
 */
export function espacamentoMinimo(marcarTodos: boolean, aceitouRisco = false): number {
  return marcarTodos && !aceitouRisco ? ESPACAMENTO_MINIMO_MARCAR_TODOS_S : ESPACAMENTO_MINIMO_S
}

/** Mensagem pronta para a tela quando o espaçamento pedido é baixo demais. */
export function mensagemDeEspacamentoBaixo(marcarTodos: boolean, aceitouRisco = false): string {
  const piso = espacamentoMinimo(marcarTodos, aceitouRisco)
  return marcarTodos && !aceitouRisco
    ? `Marcando todos, o intervalo recomendado mínimo é de ${piso} segundos entre um grupo e outro. ` +
        'Para ir abaixo disso, ative o modo avançado de “Marcar todos”.'
    : `O intervalo mínimo é de ${piso} segundos entre um grupo e outro.`
}

/**
 * Espera real (ms) até o próximo envio: o espaçamento com a variação aleatória.
 * `aleatorio` entra por parâmetro para dar para testar sem depender de sorte.
 */
export function proximaEspera(
  espacamentoS: number,
  jitterPct: number,
  aleatorio: () => number = Math.random
): number {
  const fator = 1 + (aleatorio() * 2 - 1) * (jitterPct / 100)
  return Math.round(espacamentoS * fator * 1000)
}

/** Menor espera que o servidor aceita entre dois envios da mesma execução. */
export function esperaMinimaAceita(espacamentoS: number, jitterPct: number): number {
  return Math.max(
    0,
    Math.round(espacamentoS * (1 - jitterPct / 100) * 1000) - TOLERANCIA_ESPACAMENTO_MS
  )
}
