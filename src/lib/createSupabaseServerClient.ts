/**
 * Create a Supabase client for use in Next.js API routes (App Router)
 * Extracts the authorization token from the request headers
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Create a Supabase client with authentication from request headers
 * @param request - The incoming Request object
 * @returns Supabase client instance
 */
export function createSupabaseServerClient(request: Request): SupabaseClient {
  // Extract the authorization header from the request
  const authHeader = request.headers.get('authorization');
  
  console.log('[createSupabaseServerClient] Auth header:', authHeader ? `exists (${authHeader.substring(0, 30)}...)` : 'MISSING');
  
  // Create a client with the auth token if present
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: authHeader ? {
        Authorization: authHeader, // Capital 'A' is important!
      } : {},
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabase;
}

