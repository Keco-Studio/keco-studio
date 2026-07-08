import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  getUnauthenticatedAction,
  shouldBypassProxyAuth,
} from '@/lib/auth/proxyPolicy';

const AUTH_CHECK_TIMEOUT_MS = 8000;

function buildUnauthenticatedResponse(request: NextRequest): NextResponse {
  const action = getUnauthenticatedAction(request.nextUrl.pathname);

  if (action.type === 'next') {
    return NextResponse.next({
      request: {
        headers: request.headers,
      },
    });
  }

  if (action.type === 'json') {
    return NextResponse.json(action.body, { status: action.status });
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = action.destination;
  redirectUrl.searchParams.set(
    'redirectTo',
    `${request.nextUrl.pathname}${request.nextUrl.search}`
  );

  return NextResponse.redirect(redirectUrl);
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // Development mode skips Supabase network checks so the app remains usable offline.
  if (shouldBypassProxyAuth()) {
    return response;
  }

  if (getUnauthenticatedAction(request.nextUrl.pathname).type === 'next') {
    return response;
  }

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll().map((cookie) => ({
              name: cookie.name,
              value: cookie.value,
            }));
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set(name, value);
              response.cookies.set({
                name,
                value,
                ...options,
              });
            });
          },
        },
      }
    );

    // Refresh session if expired - with timeout so slow/unreachable Supabase doesn't block the whole page
    let user: { id: string; email?: string } | null = null;
    try {
      const result = await Promise.race([
        supabase.auth.getUser(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Auth check timeout')), AUTH_CHECK_TIMEOUT_MS)
        ),
      ]);
      user = result?.data?.user ?? null;
    } catch (err) {
      console.warn('[proxy] Supabase auth check failed or timed out:', (err as Error)?.message);
      return buildUnauthenticatedResponse(request);
    }

    if (!user) {
      return buildUnauthenticatedResponse(request);
    }
  } catch (err) {
    console.warn('[proxy] Supabase init or auth failed:', (err as Error)?.message);
    return buildUnauthenticatedResponse(request);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
