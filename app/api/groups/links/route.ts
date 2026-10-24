import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/api-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { tabelaNaoExiste } from '@/lib/groups/install'
import { ehTipoDeLink, gerarSlug, validarAlvo, validarSlug } from '@/lib/groups/links-curtos'

/**
 * GET  /api/groups/links — lista os links curtos, com os cliques.
 * POST /api/groups/links — cria um: `{ tipo, alvo, rotulo?, slug?, mensagem? }`.
 *
 * Mesma regra das outras rotas: a tela não é fronteira de segurança. O destino é
 * validado AQUI (domínio do tipo escolhido, sempre https, sem usuário embutido);
 * a migration ainda recusa tudo que não seja https. Sem isso, o painel viraria um
 * redirecionador aberto — a ferramenta preferida de phishing em grupo de WhatsApp.
 */

const PENDENTE = {
  error: 'A migration 017 (links curtos) ainda não foi aplicada no banco.',
  migracaoPendente: true,
}

export async function GET(): Promise<NextResponse> {
  const { error: authError } = await requireAuth()
  if (authError) return authError

  const db = await createServiceClient()
  const { data, error } = await db
    .from('short_links')
    .select('id, slug, kind, target_url, label, active, clicks, last_click_at, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    if (tabelaNaoExiste(error)) return NextResponse.json(PENDENTE, { status: 503 })
    console.error('[groups/links] falha ao listar:', error.message)
    return NextResponse.json({ error: 'Erro ao consultar o banco.' }, { status: 500 })
  }

  return NextResponse.json({ links: data ?? [] })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { user, error: authError } = await requireAuth()
  if (authError) return authError

  let corpo: Record<string, unknown>
  try {
    const bruto = await request.json()
    if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) throw new Error()
    corpo = bruto as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 })
  }

  if (!ehTipoDeLink(corpo.tipo)) {
    return NextResponse.json({ error: 'Escolha o tipo do link.' }, { status: 400 })
  }
  if (typeof corpo.alvo !== 'string') {
    return NextResponse.json({ error: 'Informe o endereço de destino.' }, { status: 400 })
  }

  const alvo = validarAlvo(corpo.tipo, corpo.alvo, typeof corpo.mensagem === 'string' ? corpo.mensagem : undefined)
  if (!alvo.ok) return NextResponse.json({ error: alvo.erro }, { status: 400 })

  const personalizado = typeof corpo.slug === 'string' && corpo.slug.trim() !== ''
  let slugPedido: string | null = null
  if (personalizado) {
    const v = validarSlug(corpo.slug as string)
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 })
    slugPedido = v.slug
  }

  const rotulo = typeof corpo.rotulo === 'string' ? corpo.rotulo.trim().slice(0, 120) || null : null
  const db = await createServiceClient()

  // Slug sorteado pode colidir (raro: 31^7 combinações). Slug escolhido pela pessoa
  // que já existe NÃO é tentado de novo — é dela a decisão de trocar.
  const tentativas = personalizado ? 1 : 5
  for (let i = 0; i < tentativas; i++) {
    const slug = slugPedido ?? gerarSlug()

    const { data, error } = await db
      .from('short_links')
      .insert({ slug, kind: corpo.tipo, target_url: alvo.url, label: rotulo, created_by: user.id })
      .select('id, slug')
      .single()

    if (!error && data) return NextResponse.json({ link: data }, { status: 201 })

    if (error && tabelaNaoExiste(error)) return NextResponse.json(PENDENTE, { status: 503 })

    if (error?.code === '23505') {
      if (personalizado) {
        return NextResponse.json({ error: 'Já existe um link com esse nome. Escolha outro.', slugEmUso: true }, { status: 409 })
      }
      continue
    }

    console.error('[groups/links] falha ao criar:', error?.message)
    return NextResponse.json({ error: 'Não foi possível criar o link.' }, { status: 500 })
  }

  return NextResponse.json({ error: 'Não foi possível gerar um endereço único. Tente de novo.' }, { status: 500 })
}
