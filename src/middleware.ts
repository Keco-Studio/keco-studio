import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const AUTH_CHECK_TIMEOUT_MS = 8000;

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // 开发环境：跳过 Supabase 校验，避免因网络/墙导致首屏一直打不开
  if (process.env.NODE_ENV === 'development') {
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
      console.warn('[middleware] Supabase auth check failed or timed out:', (err as Error)?.message);
      return response;
    }

    if (user) {
      let session: { access_token: string; refresh_token?: string; expires_in?: number; expires_at?: number; token_type?: string; user: { id: string; email?: string } } | null = null;
      try {
        const sessionResult = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('getSession timeout')), 3000)
          ),
        ]);
        session = sessionResult?.data?.session ?? null;
      } catch {
        /* skip cookie sync */
      }

      if (session) {
        const sessionJson = JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          expires_in: session.expires_in,
          expires_at: session.expires_at,
          token_type: session.token_type,
          user: { id: session.user.id, email: session.user.email },
        });
        response.cookies.set('sb-session', sessionJson, {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 7,
          path: '/',
        });
        response.cookies.set('sb-access-token', session.access_token, {
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 7,
          path: '/',
        });
      }
    }
  } catch (err) {
    console.warn('[middleware] Supabase init or auth failed:', (err as Error)?.message);
    return response;
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

