import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabasePublishableKey, supabaseUrl } from '@/lib/env';

// Pages that work without signing in.
const PUBLIC_PATHS = ['/login', '/forgot-password', '/auth/confirm'];

// Runs before every page request: refreshes the Supabase session cookie and sends signed-out
// visitors to /login. This is a convenience layer only. Pages, Server Actions and the database
// (RLS) each check access again on their own.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        // No-cache headers, so a shared cache never serves one person's session to another.
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Verifies the session token and refreshes it if needed. Keep this the first call on the client.
  const { data } = await supabase.auth.getClaims();

  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (!data?.claims && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    if (pathname !== '/') loginUrl.searchParams.set('next', `${pathname}${search}`);
    return redirectKeepingSession(loginUrl, response);
  }

  return response;
}

// A redirect must carry any refreshed session cookies, or the browser keeps a stale session.
function redirectKeepingSession(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  from.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  for (const header of ['cache-control', 'expires', 'pragma']) {
    const value = from.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}

export const config = {
  // Everything except Next.js build assets and static images.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
