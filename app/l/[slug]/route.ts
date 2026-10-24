import { NextRequest } from 'next/server'

import { createServiceClient } from '@/lib/supabase/server'
import {
  detectarPlataforma, ehRobo, ehSlugConsultavel, enderecoDoApp, ehTipoDeLink,
  paginaDeRedirecionamento,
} from '@/lib/groups/links-curtos'

/**
 * GET /l/[slug] — o link curto público.
 *
 * Aberta por visitante ANÔNIMO e por robôs de prévia, então é de propósito o mais
 * magro possível: sem React, uma ida ao banco, e a decisão do que fazer sai de
 * funções puras (`lib/groups/links-curtos.ts`, onde estão os testes).
 *
 *  - Robô (a prévia do WhatsApp inclusive): resolve SEM contar e redireciona para
 *    o destino, para a prévia mostrar o cartão do vídeo/perfil de verdade. Se
 *    contasse, cada grupo que recebesse a mensagem geraria um clique falso.
 *  - Pessoa no celular, com destino que tem app: página que tenta abrir o app e,
 *    se não abrir, cai no site depois de ~900 ms.
 *  - Qualquer outro caso: redirecionamento direto. O WhatsApp (convite e conversa)
 *    nunca precisa de intermediário — `chat.whatsapp.com` e `wa.me` já abrem o app.
 *
 * Fora do `matcher` do middleware (sem cookie nenhum, não há o que renovar).
 */

const SEM_CACHE = { 'cache-control': 'no-store' }

const naoEncontrado = () =>
  new Response(
    '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex">' +
      '<title>Link não encontrado</title><body style="font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;color:#444">' +
      '<p>Este link não existe ou foi desativado.</p>',
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', ...SEM_CACHE } }
  )

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params

  // Forma inválida nem chega ao banco.
  if (!ehSlugConsultavel(slug)) return naoEncontrado()

  const userAgent = request.headers.get('user-agent')
  const robo = ehRobo(userAgent)

  const db = await createServiceClient()
  const { data, error } = await db.rpc('resolve_short_link', { p_slug: slug, p_count: !robo })

  if (error) {
    // Migration 017 ausente ou banco fora: o visitante vê "não encontrado", o log diz o motivo.
    console.error('[l] falha ao resolver o link curto:', error.message)
    return naoEncontrado()
  }

  const link = data?.[0]
  if (!link) return naoEncontrado()

  const alvo = link.target_url
  const direto = () => Response.redirect(alvo, 302)

  if (robo || !ehTipoDeLink(link.kind)) return withNoStore(direto())

  const app = enderecoDoApp(link.kind, alvo, detectarPlataforma(userAgent))
  if (!app) return withNoStore(direto())

  return new Response(paginaDeRedirecionamento(alvo, app), {
    headers: { 'content-type': 'text/html; charset=utf-8', ...SEM_CACHE },
  })
}

/** `Response.redirect` devolve cabeçalhos imutáveis: refaz a resposta com o cache desligado. */
function withNoStore(r: Response): Response {
  return new Response(null, { status: r.status, headers: { location: r.headers.get('location') ?? '/', ...SEM_CACHE } })
}
