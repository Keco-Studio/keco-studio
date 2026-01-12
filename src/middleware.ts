import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

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

  // Try to get existing session first (don't force refresh on every request)
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // If session exists and is valid, sync to cookies
  if (session?.user) {
    // Check if token is about to expire (within 5 minutes)
    const expiresAt = session.expires_at ? session.expires_at * 1000 : 0;
    const now = Date.now();
    const isExpiringSoon = expiresAt > 0 && (expiresAt - now) < 5 * 60 * 1000;
    
    // If token is expiring soon, try to refresh it
    let activeSession = session;
    if (isExpiringSoon) {
      const { data: { session: refreshedSession }, error } = await supabase.auth.refreshSession();
      if (!error && refreshedSession) {
        activeSession = refreshedSession;
      }
    }
    
    // Store full session as JSON in cookie (for hybrid adapter)
    const sessionJson = JSON.stringify({
      access_token: activeSession.access_token,
      refresh_token: activeSession.refresh_token,
      expires_in: activeSession.expires_in,
      expires_at: activeSession.expires_at,
      token_type: activeSession.token_type,
      user: {
        id: activeSession.user.id,
        email: activeSession.user.email,
      },
    });
    
    response.cookies.set('sb-session', sessionJson, {
      httpOnly: false, // Allow client-side access for hybrid adapter
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year - let Supabase handle token expiry
      path: '/',
    });
    
    // Also set individual tokens for backward compatibility
    response.cookies.set('sb-access-token', activeSession.access_token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: '/',
    });
  }
  // Don't automatically clear cookies if no session - let client handle it
  // This prevents clearing cookies during page transitions

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

