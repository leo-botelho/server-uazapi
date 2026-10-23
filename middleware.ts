import { updateSession } from '@/lib/supabase/middleware'
import { NextResponse, type NextRequest } from 'next/server'

const ADMIN_ROUTES = [
  '/dashboard',
  '/instances',
  '/clients',
  '/servers',
  '/alerts',
  '/logs',
  '/settings',
  '/profile',
  // ⚠️ Toda rota nova de admin precisa entrar nesta lista. Sem a entrada, a
  // página continua funcionando — e fica acessível sem login.
  '/groups',
]

export async function middleware(request: NextRequest) {
  const { user, supabaseResponse } = await updateSession(request)

  const isAdminRoute = ADMIN_ROUTES.some((route) =>
    request.nextUrl.pathname.startsWith(route)
  )

  // Protect admin routes
  if (isAdminRoute && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirectTo', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }

  // Redirect logged-in users away from login page
  if (request.nextUrl.pathname === '/login' && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - api/webhook (webhook endpoint - needs to be public)
     *
     * As rotas abaixo ficam de fora porque não têm cookie de sessão nenhum e
     * passar por `updateSession()` só desperdiça trabalho: ele monta um cliente
     * SSR do Supabase e chama `auth.getUser()` em TODA requisição que casa com
     * o matcher. Nos crons isso acontecia centenas de vezes por dia à toa,
     * justamente nas rotas onde CPU é o recurso escasso.
     *
     * - api/monitor/tick       chamada pelo worker de cron, com secret próprio
     * - api/groups/scheduler   idem, para o módulo de grupos
     * - l/                     redirecionador público de link curto
     */
    '/((?!_next/static|_next/image|favicon.ico|api/webhook|api/monitor/tick|api/groups/scheduler|l/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
