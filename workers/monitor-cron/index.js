/**
 * Worker de cron do monitor.
 *
 * Existe porque duas alternativas nao servem:
 *  - O worker principal e gerado pelo OpenNext e exporta apenas o handler
 *    `fetch`, entao um Cron Trigger do Cloudflare nao alcanca as rotas do app.
 *  - O agendador do GitHub Actions e best-effort: na pratica os ticks de 5 min
 *    sairam de hora em hora, com lacunas de ate 7h30. Uma instancia reconectou
 *    numa dessas lacunas e o painel so atualizou no "Sincronizar" manual.
 *
 * Este worker nao faz nada alem de chamar POST /api/monitor/tick no horario.
 * Cron Triggers do Cloudflare disparam com pontualidade de segundos.
 *
 * Variaveis:
 *   MONITOR_URL    — var publica no wrangler.toml
 *   MONITOR_SECRET — secret (wrangler secret put)
 */
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env))
  },

  // Permite disparo manual para teste: GET/POST na URL do worker.
  async fetch(request, env) {
    const result = await tick(env)
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 502,
      headers: { 'content-type': 'application/json' },
    })
  },
}

async function tick(env) {
  const url = (env.MONITOR_URL ?? '').replace(/\s+/g, '')
  const key = (env.MONITOR_SECRET ?? '').replace(/\s+/g, '')

  if (!url || !key) {
    console.error('[cron] MONITOR_URL ou MONITOR_SECRET ausente')
    return { ok: false, error: 'missing config' }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-monitor-secret': key },
      signal: AbortSignal.timeout(60_000),
    })

    const body = await res.text()
    console.log(`[cron] tick HTTP ${res.status}: ${body.slice(0, 500)}`)
    return { ok: res.ok, status: res.status, body: body.slice(0, 1000) }
  } catch (err) {
    console.error('[cron] falha ao chamar o monitor:', err instanceof Error ? err.message : String(err))
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
