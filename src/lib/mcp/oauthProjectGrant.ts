import type { SupabaseClient } from '@supabase/supabase-js';

export async function prepareOAuthProjectGrant(
  supabase: SupabaseClient,
  authorizationId: string,
  projectId: string,
  resource: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('prepare_oauth_project_grant', {
    p_authorization_id: authorizationId,
    p_project_id: projectId,
    p_resource: resource,
  });

  if (error) throw error;
  return data === true;
}

export async function finalizeOAuthProjectGrant(
  supabase: SupabaseClient,
  authorizationId: string,
  projectId: string,
  resource: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('finalize_oauth_project_grant', {
    p_authorization_id: authorizationId,
    p_project_id: projectId,
    p_resource: resource,
  });

  if (error) throw error;
  return data === true;
}
