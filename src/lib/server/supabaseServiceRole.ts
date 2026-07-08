import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function getSupabaseServiceRoleClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error('Supabase URL is not configured');
  }

  if (!supabaseServiceRole) {
    throw new Error('Supabase service role key is not configured');
  }

  return createClient(supabaseUrl, supabaseServiceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
