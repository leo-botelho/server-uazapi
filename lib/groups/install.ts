import { createServiceClient } from '@/lib/supabase/server'

/**
 * Detecta se a migration 015 já foi aplicada no Supabase.
 *
 * Migrations neste projeto são aplicadas À MÃO, no SQL Editor. Código que usa
 * uma tabela antes disso não falha de forma visível — o PostgREST recusa e a
 * escrita some em silêncio. Já aconteceu (migration 009) e derrubou o webhook,
 * o monitor e o portal do cliente de uma vez.
 *
 * `withMissingColumnFallback` não cobre este caso: ele trata COLUNA faltando
 * (PGRST204). TABELA faltando é outro código e nenhum fallback salva. Por isso
 * a tela mostra um aviso explicando o que fazer, em vez de quebrar.
 */

export type EstadoDaInstalacao =
  | { estado: 'ok' }
  | { estado: 'pendente'; detalhe: string }
  | { estado: 'erro'; detalhe: string }

export function tabelaNaoExiste(error: { code?: string; message: string }): boolean {
  return (
    error.code === 'PGRST205' ||   // tabela ausente no schema cache do PostgREST
    error.code === '42P01'   ||   // undefined_table
    /relation .* does not exist|Could not find the table/i.test(error.message)
  )
}

/** Uma consulta mínima: só confirma que a tabela responde. */
export async function verificarInstalacaoDeGrupos(): Promise<EstadoDaInstalacao> {
  const db = await createServiceClient()

  const { error } = await db
    .from('group_cache')
    .select('group_jid')
    .limit(1)

  if (!error) return { estado: 'ok' }

  if (tabelaNaoExiste(error)) {
    return { estado: 'pendente', detalhe: error.message }
  }

  console.error('[groups/install] falha ao verificar a instalação:', error.message)
  return { estado: 'erro', detalhe: error.message }
}
