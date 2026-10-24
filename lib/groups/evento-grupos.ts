/**
 * Amostra diagnóstica do evento `groups` do webhook global.
 *
 * Por que existe: a mensagem de boas-vindas depende de saber QUEM entrou e EM
 * QUAL grupo, e o formato do evento `groups` não está na spec da uazapiGO. Montar
 * um tratador em cima de um palpite, no caminho de produção do monitor e dos
 * agentes, seria código especulativo. Então o primeiro passo é só OBSERVAR: o
 * evento chega, uma amostra mascarada vai para o log, e o formato real vira a
 * especificação do tratador.
 *
 * O que NUNCA pode ir para o log: o `token` da instância (credencial dela) e os
 * telefones dos participantes (dado pessoal).
 */

/** Chaves que carregam credencial. Comparação sem diferenciar maiúsculas. */
const CHAVES_SECRETAS = new Set([
  'token', 'admintoken', 'apikey', 'api_key', 'authorization', 'secret', 'password', 'qrcode', 'paircode',
])

const LIMITE_DE_PROFUNDIDADE = 8

/**
 * Cópia do objeto sem as credenciais. Percorre arrays e objetos aninhados; o que
 * passa da profundidade vira "[fundo demais]" em vez de arriscar um ciclo.
 */
export function semSegredos(valor: unknown, profundidade = 0): unknown {
  if (profundidade > LIMITE_DE_PROFUNDIDADE) return '[fundo demais]'
  if (Array.isArray(valor)) return valor.map((v) => semSegredos(v, profundidade + 1))

  if (typeof valor === 'object' && valor !== null) {
    const saida: Record<string, unknown> = {}
    for (const [chave, v] of Object.entries(valor)) {
      saida[chave] = CHAVES_SECRETAS.has(chave.toLowerCase()) ? '[removido]' : semSegredos(v, profundidade + 1)
    }
    return saida
  }

  return valor
}

/**
 * Mascara telefones (10 a 15 dígitos seguidos), deixando os 4 últimos para dar
 * para distinguir uma pessoa da outra no log. Identificadores de grupo têm 18
 * dígitos e NÃO são mascarados: sem eles não dá para saber de qual grupo veio o
 * evento. A janela exata de dígitos evita pegar um pedaço de um número maior.
 */
export function mascararTelefones(texto: string): string {
  return texto.replace(/(?<![0-9])(\d{10,15})(?![0-9])/g, (numero) => `${'*'.repeat(numero.length - 4)}${numero.slice(-4)}`)
}

/** O que vai para o log: sem credenciais, telefones mascarados, com teto de tamanho. */
export function amostraDoEvento(bruto: unknown, limite = 1500): string {
  let texto: string
  try {
    texto = JSON.stringify(semSegredos(bruto)) ?? ''
  } catch {
    return '[payload não serializável]'
  }

  const mascarado = mascararTelefones(texto)
  return mascarado.length > limite ? `${mascarado.slice(0, limite)}…[+${mascarado.length - limite}]` : mascarado
}

/** Quantas amostras cada instância do Worker registra: o suficiente para ver o formato, sem encher o log. */
export const MAX_AMOSTRAS_POR_ISOLATE = 30

let registradas = 0

/**
 * Registra uma amostra do evento, no máximo `MAX_AMOSTRAS_POR_ISOLATE` vezes.
 * Nunca lança: é diagnóstico, não pode derrubar o webhook.
 */
export function registrarAmostraDeGrupos(
  bruto: unknown,
  escrever: (linha: string) => void = (l) => console.log(l)
): boolean {
  if (registradas >= MAX_AMOSTRAS_POR_ISOLATE) return false

  try {
    registradas++
    escrever(`[webhook] amostra do evento groups (${registradas}/${MAX_AMOSTRAS_POR_ISOLATE}): ${amostraDoEvento(bruto)}`)
    return true
  } catch {
    return false
  }
}

/** Só para teste. */
export const reiniciarContadorDeAmostras = () => { registradas = 0 }
