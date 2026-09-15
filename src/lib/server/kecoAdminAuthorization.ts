import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isKecoAdminUser(
  userId: string,
  configuredId: string | undefined = process.env.KECO_ADMIN_USER_ID,
): boolean {
  return Boolean(
    configuredId &&
      UUID_PATTERN.test(configuredId) &&
      userId === configuredId,
  );
}

/**
 * Check the authenticated user's admin allowlist row. The client must carry
 * the user's session so the table's self-access RLS policy is enforced.
 */
export async function hasKecoAdminAccess(
  userId: string,
  supabase: SupabaseClient,
  configuredId: string | undefined = process.env.KECO_ADMIN_USER_ID,
): Promise<boolean> {
  if (isKecoAdminUser(userId, configuredId)) return true;

  try {
    const { data, error } = await supabase
      .from('keco_admin_users')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    return !error && data?.user_id === userId;
  } catch {
    return false;
  }
}
