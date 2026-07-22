import type { SupabaseClient } from '@supabase/supabase-js';

export async function getOAuthAuthorizationResource(
  supabase: SupabaseClient,
  authorizationId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_oauth_authorization_resource', {
    p_authorization_id: authorizationId,
  });

  if (error) throw error;
  return typeof data === 'string' ? data : null;
}
