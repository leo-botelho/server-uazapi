import { linkDeConversa, linkDeConvite } from './deeplinks'

/**
 * Links curtos com contagem de cliques (`/l/<slug>`).
 *
 * Por que existe: o WhatsApp só deixa clicável um endereço http(s), então um
 * `instagram://…` colado numa mensagem não funciona. O que funciona é um link
 * https curto que, no celular, tenta abrir o app e cai para o site se não der.
 * É também o que dá a contagem de cliques dos links de convite.
 *
 * Tudo aqui é puro: o que decide se um endereço vira link curto, e para onde ele
 * leva, é a parte que mais importa acertar — um redirecionador que aceita
 * qualquer endereço é a ferramenta preferida de quem faz phishing.
 */

export const TIPOS_DE_LINK = ['youtube', 'instagram', 'whatsapp_grupo', 'whatsapp_conversa'] as const
export type TipoDeLink = (typeof TIPOS_DE_LINK)[number]

export const ROTULO_DO_TIPO_DE_LINK: Record<TipoDeLink, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  whatsapp_grupo: 'Convite de grupo',
  whatsapp_conversa: 'Conversa no WhatsApp',
}

export const ehTipoDeLink = (v: unknown): v is TipoDeLink =>
  typeof v === 'string' && (TIPOS_DE_LINK as readonly string[]).includes(v)

export type ResultadoDoAlvo =
  | { ok: true; url: string }
  | { ok: false; erro: string }

const HOSTS_YOUTUBE = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'])
const HOSTS_INSTAGRAM = new Set(['instagram.com', 'www.instagram.com'])

function lerUrl(bruta: string): URL | null {
  const texto = bruta.trim()
  if (!texto) return null
  try {
    const url = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`)
    return url
  } catch {
    return null
  }
}

/**
 * Valida e NORMALIZA o endereço de destino conforme o tipo. O destino é sempre
 * https, de um domínio conhecido do tipo escolhido, sem usuário e senha embutidos
 * (`https://youtube.com@evil.com` engana quem lê a URL por cima).
 */
export function validarAlvo(tipo: TipoDeLink, bruta: string, mensagem?: string): ResultadoDoAlvo {
  if (tipo === 'whatsapp_grupo') {
    const r = linkDeConvite(bruta)
    return r.ok ? { ok: true, url: r.url } : r
  }

  if (tipo === 'whatsapp_conversa') {
    const r = linkDeConversa(bruta, mensagem)
    return r.ok ? { ok: true, url: r.url } : r
  }

  const url = lerUrl(bruta)
  if (!url) return { ok: false, erro: 'Esse endereço não é válido.' }

  if (url.username || url.password) {
    return { ok: false, erro: 'O endereço não pode ter usuário e senha embutidos.' }
  }

  const hosts = tipo === 'youtube' ? HOSTS_YOUTUBE : HOSTS_INSTAGRAM
  if (!hosts.has(url.hostname.toLowerCase())) {
    return {
      ok: false,
      erro: tipo === 'youtube'
        ? 'O link precisa ser do YouTube (youtube.com ou youtu.be).'
        : 'O link precisa ser do Instagram (instagram.com).',
    }
  }

  // Sempre https, mesmo que tenham colado http.
  url.protocol = 'https:'
  url.port = ''
  return { ok: true, url: url.toString() }
}

// ─────────────────────────────────────────────────────────────────────────────
// Slug
// ─────────────────────────────────────────────────────────────────────────────

/** Sem caracteres que se confundem (0/o, 1/l/i): o link é lido e digitado por gente. */
const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789'
export const TAMANHO_DO_SLUG = 7

/** `sorteio` entra por parâmetro para dar para testar sem depender de sorte. */
export function gerarSlug(sorteio: (n: number) => number[] = sorteioSeguro): string {
  // Rejeita valores que enviesariam a escolha (256 não é múltiplo de 31).
  const limite = 256 - (256 % ALFABETO.length)
  let saida = ''
  while (saida.length < TAMANHO_DO_SLUG) {
    for (const b of sorteio(TAMANHO_DO_SLUG * 2)) {
      if (b < limite && saida.length < TAMANHO_DO_SLUG) saida += ALFABETO[b % ALFABETO.length]
    }
  }
  return saida
}

function sorteioSeguro(n: number): number[] {
  return [...crypto.getRandomValues(new Uint8Array(n))]
}

const SLUG_VALIDO = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/

export function validarSlug(bruto: string): { ok: true; slug: string } | { ok: false; erro: string } {
  const slug = bruto.trim().toLowerCase()
  if (!SLUG_VALIDO.test(slug)) {
    return { ok: false, erro: 'Use de 3 a 40 letras minúsculas, números ou hífen (sem começar nem terminar com hífen).' }
  }
  return { ok: true, slug }
}

/** Forma que o slug precisa ter para a rota pública sequer consultar o banco. */
export const ehSlugConsultavel = (v: string) => SLUG_VALIDO.test(v)

// ─────────────────────────────────────────────────────────────────────────────
// Quem está clicando
// ─────────────────────────────────────────────────────────────────────────────

export type Plataforma = 'android' | 'ios' | 'outra'

export function detectarPlataforma(userAgent: string | null | undefined): Plataforma {
  const ua = userAgent ?? ''
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  return 'outra'
}

/**
 * Robôs e geradores de prévia. NÃO CONTAM clique.
 *
 * É o caso que mais importa aqui: quando alguém manda o link num grupo, o
 * WhatsApp busca a página para montar a prévia — e cada grupo que recebe a
 * mensagem geraria um "clique" falso. O mesmo vale para Facebook, Telegram,
 * Google e qualquer verificador de link.
 */
const PADRAO_DE_ROBO =
  /whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|slackbot|discordbot|linkedinbot|pinterest|skypeuripreview|googlebot|google-inspectiontool|bingbot|bot\b|crawler|spider|preview|headless|curl\/|wget\/|python-requests|go-http-client/i

export function ehRobo(userAgent: string | null | undefined): boolean {
  // Sem User-Agent nenhum, navegador de gente não é: trata como robô.
  if (!userAgent || !userAgent.trim()) return true
  return PADRAO_DE_ROBO.test(userAgent)
}

// ─────────────────────────────────────────────────────────────────────────────
// Abrir no app
// ─────────────────────────────────────────────────────────────────────────────

/** O vídeo do YouTube de um endereço, ou null (canal, playlist, página inicial…). */
function idDoVideo(url: URL): string | null {
  const host = url.hostname.toLowerCase()
  const valido = (v: string | null | undefined) => (v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null)

  if (host === 'youtu.be') return valido(url.pathname.split('/')[1])
  if (url.pathname === '/watch') return valido(url.searchParams.get('v'))

  const atalho = /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)
  return atalho ? valido(atalho[1]) : null
}

/** O perfil do Instagram (`/usuario`), ou null para posts, reels, explorar etc. */
function perfilDoInstagram(url: URL): string | null {
  const m = /^\/([A-Za-z0-9._]{1,30})\/?$/.exec(url.pathname)
  if (!m) return null
  const reservados = new Set(['p', 'reel', 'reels', 'explore', 'stories', 'accounts', 'direct', 'tv'])
  return reservados.has(m[1].toLowerCase()) ? null : m[1]
}

/**
 * O endereço que tenta abrir o aplicativo, ou null quando não há como (e então o
 * clique vai direto para o https).
 *
 * ⚠️ HEURÍSTICA, não verificada em aparelho real. No Android usa `intent://`, que
 * abre o app se instalado e cai no https se não; no iOS usa o esquema do app. O
 * Instagram só sabe abrir PERFIL: post e reel precisam de um id numérico que não
 * dá para tirar do endereço. Se o esquema falhar, a página volta para o https.
 */
export function enderecoDoApp(tipo: TipoDeLink, alvo: string, plataforma: Plataforma): string | null {
  if (plataforma === 'outra') return null
  if (tipo !== 'youtube' && tipo !== 'instagram') return null

  let url: URL
  try { url = new URL(alvo) } catch { return null }

  if (tipo === 'youtube') {
    const id = idDoVideo(url)
    if (!id) return null
    return plataforma === 'ios'
      ? `youtube://www.youtube.com/watch?v=${id}`
      : `intent://www.youtube.com/watch?v=${id}#Intent;package=com.google.android.youtube;scheme=https;S.browser_fallback_url=${encodeURIComponent(alvo)};end`
  }

  const perfil = perfilDoInstagram(url)
  if (!perfil) return null
  return plataforma === 'ios'
    ? `instagram://user?username=${perfil}`
    : `intent://instagram.com/_u/${perfil}/#Intent;package=com.instagram.android;scheme=https;S.browser_fallback_url=${encodeURIComponent(alvo)};end`
}

// ─────────────────────────────────────────────────────────────────────────────
// A página intermediária
// ─────────────────────────────────────────────────────────────────────────────

const escapar = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** Dentro de <script>: JSON com `<` escapado, para o conteúdo nunca fechar a tag. */
const paraScript = (v: string) => JSON.stringify(v).replace(/</g, '\\u003c')

/** Quanto esperar o app abrir antes de cair no site. */
export const ESPERA_PARA_O_APP_MS = 900

/**
 * HTML mínimo que tenta o app e cai para o https. Sem framework e sem React: é
 * uma página aberta por visitante anônimo, e no plano Free cada milissegundo de
 * CPU conta.
 */
export function paginaDeRedirecionamento(alvo: string, app: string): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>Abrindo…</title>
<style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#444;text-align:center;padding:0 24px}a{color:inherit}</style>
</head><body><p>Abrindo…<br><a href="${escapar(alvo)}">Toque aqui se não abrir sozinho</a></p>
<script>
var alvo=${paraScript(alvo)},app=${paraScript(app)};
var saiu=false;
document.addEventListener('visibilitychange',function(){if(document.hidden)saiu=true});
location.href=app;
setTimeout(function(){if(!saiu&&!document.hidden)location.replace(alvo)},${ESPERA_PARA_O_APP_MS});
</script></body></html>`
}
