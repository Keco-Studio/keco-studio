import 'server-only';

import { getSupabaseServiceRoleClient } from './supabaseServiceRole';

export async function readScriptDialogueOriginFingerprint(libraryId: string): Promise<string> {
  const { data, error } = await getSupabaseServiceRoleClient()
    .rpc('script_dialogue_origin_fingerprint', { p_library_id: libraryId });
  if (error) throw error;
  if (typeof data !== 'string' || !/^[a-f0-9]{32}$/.test(data)) {
    throw new Error('Script dialogue snapshot is unavailable.');
  }
  return data;
}
