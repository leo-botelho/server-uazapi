/**
 * Worker de cron do agendador de grupos.
 *
 * Existe pelo mesmo motivo do monitor (workers/monitor-cron): o worker gerado
 * pelo OpenNext exporta so `fetch`, entao um Cron Trigger nao alcanca as rotas
 * do app. E fica SEPARADO do monitor de proposito: o monitor e o que avisa o
 * cliente quando o WhatsApp cai, e um bug ou um fetch travado aqui nao pode
 * derrubar o aviso.
 *
 * ── Por que ele consulta o banco antes de chamar o app ───────────────────────
 * O plano e o Free do Cloudflare (10 ms de CPU por chamada). Acordar o app
 * Next.js inteiro todo minuto — 1.440 vezes por dia — so para ele descobrir que
 * nao ha nada a fazer e a melhor forma de reabrir o problema de CPU que o
 * monitor ja causou. Aqui a pergunta "ha trabalho?" custa UMA consulta leve ao
 * PostgREST; o app so e acordado quando ha ocorrencia aberta, em andamento ou
 * com horario chegando.
 *
 * Variaveis:
 *   GROUPS_TICK_URL            — var publica no wrangler.toml
 *   GROUPS_RUNNER_SECRET       — secret (o mesmo do app)
 *   SUPABASE_URL               — secret
 *   SUPABASE_SERVICE_ROLE_KEY  — secret
 */
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env, { force: false }))
  },

  // Disparo manual para teste: GET/POST na URL do worker. `?force=1` chama o
  // agendador mesmo sem trabalho aparente.
  async fetch(request, env) {
    const force = new URL(request.url).searchParams.get('force') === '1'
    const result = await run(env, { force })
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 502,
      headers: { 'content-type': 'application/json' },
    })
  },
}

const limpar = (v) => (v ?? '').replace(/\s+/g, '')

/**
 * Ha alguma ocorrencia que o agendador precisa olhar agora?
 *
 * Ocorrencias `open`/`running` ja passaram do horario; as `scheduled` so contam
 * quando o horario chega nos proximos 90 s (a passada seguinte a pegaria tarde).
 * Tarefas pausadas, bloqueadas ou canceladas nao contam — senao uma pausa
 * acordaria o app todo minuto a toa.
 */
async function haTrabalho(env) {
  const base = limpar(env.SUPABASE_URL).replace(/\/$/, '')
  const key = limpar(env.SUPABASE_SERVICE_ROLE_KEY)

  if (!base || !key) return { ok: false, error: 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente' }

  const limite = new Date(Date.now() + 90_000).toISOString()
  const query =
    'select=id,group_tasks!inner(status)' +
    '&status=in.(scheduled,open,running)' +
    `&run_at=lte.${encodeURIComponent(limite)}` +
    '&group_tasks.status=in.(scheduled,running)' +
    '&limit=1'

  try {
    const res = await fetch(`${base}/rest/v1/group_task_runs?${query}`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const corpo = (await res.text()).slice(0, 300)
      return { ok: false, error: `consulta ao banco HTTP ${res.status}: ${corpo}` }
    }

    const linhas = await res.json()
    return { ok: true, trabalho: Array.isArray(linhas) && linhas.length > 0 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function run(env, { force }) {
  const url = limpar(env.GROUPS_TICK_URL)
  const secret = limpar(env.GROUPS_RUNNER_SECRET)

  if (!url || !secret) {
    console.error('[groups-runner] GROUPS_TICK_URL ou GROUPS_RUNNER_SECRET ausente')
    return { ok: false, error: 'missing config' }
  }

  if (!force) {
    const consulta = await haTrabalho(env)

    if (!consulta.ok) {
      // Falhar a consulta NAO chama o app as cegas: sem saber, e mais seguro nao enviar.
      console.error('[groups-runner] nao foi possivel saber se ha trabalho:', consulta.error)
      return { ok: false, error: consulta.error }
    }

    if (!consulta.trabalho) {
      return { ok: true, skipped: true, reason: 'sem trabalho' }
    }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-groups-secret': secret },
      signal: AbortSignal.timeout(60_000),
    })

    const body = await res.text()
    console.log(`[groups-runner] tick HTTP ${res.status}: ${body.slice(0, 500)}`)
    return { ok: res.ok, status: res.status, body: body.slice(0, 1000) }
  } catch (err) {
    console.error('[groups-runner] falha ao chamar o agendador:', err instanceof Error ? err.message : String(err))
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
