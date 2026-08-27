/**
 * Tolerancia a migrations ainda nao aplicadas.
 *
 * Motivo real: colunas novas (`last_seen_at`, `scheduled_for`, `reason`) foram
 * usadas em codigo antes de a migration correspondente rodar no Supabase. O
 * PostgREST rejeita a operacao INTEIRA com "Could not find the 'x' column",
 * entao a gravacao de status parou de funcionar por completo — webhook, monitor
 * e portal do cliente falhavam em silencio, e so o botao "Sincronizar"
 * atualizava o painel, justamente por nao tocar nas colunas novas.
 *
 * Falhar assim e inaceitavel para o caminho critico: e melhor gravar o status
 * sem o campo novo do que nao gravar nada. Este helper detecta a coluna
 * ausente, remove do payload e tenta de novo, avisando alto no log.
 */

type DbResult<T> = { data: T | null; error: { message: string } | null }

/** Extrai o nome da coluna de mensagens do PostgREST (codigo PGRST204). */
function missingColumn(message: string): string | null {
  const m = /Could not find the '([^']+)' column/.exec(message)
  return m?.[1] ?? null
}

/**
 * Executa a operacao; se o banco reclamar de coluna inexistente, remove esse
 * campo do payload e repete. Devolve tambem os campos descartados para que o
 * chamador possa avisar que ha migration pendente.
 */
export async function withMissingColumnFallback<T, P extends object>(
  payload: P,
  run: (p: P) => PromiseLike<DbResult<T>>,
  label: string
): Promise<DbResult<T> & { dropped: string[] }> {
  // Mutavel por dentro, mas o callback continua recebendo o tipo original para
  // que o cliente tipado do Supabase valide os campos no ponto de chamada.
  const current: Record<string, unknown> = { ...(payload as Record<string, unknown>) }
  const dropped: string[] = []

  // Uma tentativa por campo removido, com folga suficiente e limite claro.
  const maxAttempts = Object.keys(current).length + 1

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await run(current as P)

    if (!result.error) return { ...result, dropped }

    const column = missingColumn(result.error.message)
    if (!column || !(column in current)) {
      return { ...result, dropped }
    }

    delete current[column]
    dropped.push(column)
    console.error(
      `[db] ${label}: coluna "${column}" nao existe no banco — MIGRATION PENDENTE. ` +
      'Repetindo sem esse campo para nao perder a gravacao.'
    )

    if (Object.keys(current).length === 0) {
      return { data: null, error: result.error, dropped }
    }
  }

  return { data: null, error: { message: `${label}: excesso de tentativas` }, dropped }
}
