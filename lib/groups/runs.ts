import { createServiceClient } from '@/lib/supabase/server'

type Banco = Awaited<ReturnType<typeof createServiceClient>>

export interface Contagem {
  enviados: number
  falhas: number
  total: number
}

/**
 * Recalcula os contadores de uma ocorrência a partir dos items e grava.
 *
 * Os items do envio pelo navegador nascem já terminais por INSERT, e o trigger
 * de rollup da migration 015 só dispara em UPDATE — então a contagem não sobe
 * sozinha neste caminho. Duas consultas `head` (sem trazer linhas) bastam.
 */
export async function recalcularContagem(db: Banco, runId: string, total: number): Promise<Contagem> {
  const [enviados, falhas] = await Promise.all([
    db.from('group_task_items')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', runId)
      .eq('status', 'sent'),
    db.from('group_task_items')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', runId)
      .in('status', ['failed', 'skipped']),
  ])

  const contagem: Contagem = {
    enviados: enviados.count ?? 0,
    falhas: falhas.count ?? 0,
    total,
  }

  await db
    .from('group_task_runs')
    .update({ succeeded: contagem.enviados, failed: contagem.falhas })
    .eq('id', runId)

  return contagem
}

/**
 * Reserva, de forma atômica, o instante da próxima ação de uma ocorrência.
 *
 * Só grava `last_action_at` se ele ainda estiver antes de `limite` (ou vazio).
 * É o que torna o espaçamento uma garantia do SERVIDOR: duas requisições que
 * chegam juntas disputam a mesma linha, e só uma passa. Sem isso, a conferência
 * "já passou tempo suficiente?" seria lida e gravada em momentos diferentes e
 * as duas passariam.
 *
 * Dois UPDATEs com filtros simples em vez de um `.or()`: timestamps têm `:` e
 * `.`, que o PostgREST trata como separadores dentro de `or()`.
 */
export async function reservarInstante(
  db: Banco,
  runId: string,
  agoraIso: string,
  limiteIso: string
): Promise<boolean> {
  const primeira = await db
    .from('group_task_runs')
    .update({ last_action_at: agoraIso })
    .eq('id', runId)
    .eq('status', 'running')
    .is('last_action_at', null)
    .select('id')

  if ((primeira.data ?? []).length > 0) return true

  const segunda = await db
    .from('group_task_runs')
    .update({ last_action_at: agoraIso })
    .eq('id', runId)
    .eq('status', 'running')
    .lte('last_action_at', limiteIso)
    .select('id')

  return (segunda.data ?? []).length > 0
}
