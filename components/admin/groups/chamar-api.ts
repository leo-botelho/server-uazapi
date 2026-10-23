/**
 * Chamada às rotas do módulo de grupos, com o resultado já no formato que as
 * telas usam. Nunca lança: erro de rede e resposta de erro viram `ok: false`
 * com uma mensagem pronta para mostrar.
 */

export type Resposta<T> =
  | { ok: true; dados: T }
  | { ok: false; erro: string; status: number; marcadores: Record<string, unknown> }

export async function chamarApi<T = Record<string, unknown>>(
  url: string,
  corpo: Record<string, unknown>
): Promise<Resposta<T>> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    })
  } catch {
    return { ok: false, erro: 'Sem conexão com o painel. Verifique a internet e tente de novo.', status: 0, marcadores: {} }
  }

  let json: Record<string, unknown> = {}
  try {
    json = (await res.json()) as Record<string, unknown>
  } catch {
    // corpo vazio ou não-JSON: cai na mensagem genérica abaixo
  }

  if (!res.ok) {
    const { error, ...marcadores } = json
    return {
      ok: false,
      erro: typeof error === 'string' ? error : `Falha na operação (${res.status}).`,
      status: res.status,
      marcadores,
    }
  }

  return { ok: true, dados: json as T }
}

/** Endereço das rotas de grupo de uma instância. */
export const rotaDoGrupo = (instanceId: string, recurso: string) =>
  `/api/instances/${instanceId}/groups/${recurso}`
