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
]

export async function proxy(request: NextRequest) {
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
     */
    '/((?!_next/static|_next/image|favicon.ico|api/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
