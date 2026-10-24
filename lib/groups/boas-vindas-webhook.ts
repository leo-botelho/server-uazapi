import { createServiceClient } from '@/lib/supabase/server'
import { funcaoNaoExiste } from './scheduler-regras'
import { extrairEntradas, numeroDoDono } from './boas-vindas'

/**
 * Do evento `groups` do webhook global até a fila de boas-vindas.
 *
 * É chamado dentro de `after()`, depois de a resposta já ter saído, e FAZ O MÍNIMO: lê o evento
 * (funções puras, em `boas-vindas.ts`) e chama UMA função do banco, `enqueue_group_welcome`, que
 * confere a regra do grupo, evita duplicata e cria o envio. No plano Free do Cloudflare (10 ms de
 * CPU) o Worker não carrega lógica.
 *
 * NUNCA lança: um evento que não se entende, um banco fora do ar ou a migration 021 ausente não
 * podem afetar o webhook — que também sustenta o monitor de status e os alertas ao cliente.
 */

/** A migration 021 ausente é dita uma vez por instância do Worker, não a cada evento. */
let avisouMigracaoPendente = false

export async function tratarEntradasEmGrupos(raw: unknown): Promise<void> {
  try {
    const entrada = extrairEntradas(raw)
    if (!entrada) return

    const token = typeof (raw as { token?: unknown }).token === 'string' ? (raw as { token: string }).token : null
    if (!token) return

    const db = await createServiceClient()
    const r = await db.rpc('enqueue_group_welcome', {
      p_token: token,
      p_group: entrada.grupo,
      p_participants: entrada.participantes,
      p_owner: numeroDoDono(raw),
    })

    if (r.error) {
      if (funcaoNaoExiste(r.error)) {
        if (!avisouMigracaoPendente) {
          avisouMigracaoPendente = true
          console.warn('[groups/boas-vindas] a migration 021 não foi aplicada: evento ignorado.')
        }
        return
      }
      console.error('[groups/boas-vindas] falha ao enfileirar:', r.error.message)
      return
    }

    if ((r.data ?? 0) > 0) {
      console.log(`[groups/boas-vindas] ${r.data} pessoa(s) na fila de boas-vindas em ${entrada.grupo}`)
    }
  } catch (err) {
    console.error('[groups/boas-vindas] erro inesperado:', err instanceof Error ? err.message : err)
  }
}
