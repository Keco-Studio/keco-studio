/**
 * Create a Supabase client for use in Next.js API routes (App Router)
 * Extracts the authorization token from the request headers
 */

import { createClient } from '@supabase/supabase-js';
import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Create a Supabase client with authentication from request headers
 * @param request - The incoming Request object
 * @returns Supabase client instance
 */
export function createSupabaseServerClient(request: Request): SupabaseClient {
  const authHeader = request.headers.get('authorization');
  
  // Do not log token material: report only presence, never any part of the JWT.
  console.log('[createSupabaseServerClient] Auth header:', authHeader ? 'present' : 'MISSING');
  
  if (authHeader) {
    return createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  const requestCookies = parseCookieHeader(request.headers.get('cookie') ?? '')
    .filter((cookie): cookie is { name: string; value: string } => cookie.value !== undefined);

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return requestCookies;
      },
      setAll() {
        // Route handlers cannot mutate their request. The browser client owns
        // cookie persistence and refreshes the session for subsequent calls.
      },
    },
  });
}
