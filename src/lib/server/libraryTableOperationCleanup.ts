import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';

const LIBRARY_MEDIA_BUCKET = 'library-media-files';

type ExpiryResult = { releasedMediaPaths?: unknown };

function parseReleasedMediaPaths(value: unknown): string[] {
  const paths = value && typeof value === 'object'
    ? (value as ExpiryResult).releasedMediaPaths
    : undefined;
  if (!Array.isArray(paths)) {
    throw new Error('Invalid library table operation expiry result');
  }
  if (!paths.every((path) => typeof path === 'string' && path.length > 0 && !path.includes('..'))) {
    throw new Error('Invalid library table operation media path');
  }
  return paths as string[];
}

export async function cleanupExpiredLibraryTableOperations({
  serviceClient = getSupabaseServiceRoleClient(),
  limit = 100,
}: {
  serviceClient?: Pick<SupabaseClient, 'rpc' | 'storage'>;
  limit?: number;
} = {}): Promise<{ expired: number; deletedPaths: string[] }> {
  const { data, error } = await serviceClient.rpc('expire_library_table_operations', {
    p_limit: Math.max(1, Math.min(limit, 500)),
  });
  if (error) throw new Error(error.message);
  const paths = parseReleasedMediaPaths(data);

  for (const path of paths) {
    const removal = await serviceClient.storage.from(LIBRARY_MEDIA_BUCKET).remove([path]);
    if (removal.error) throw new Error(removal.error.message);
    const settlement = await serviceClient.rpc('service_settle_project_storage_file_deletion', {
      p_bucket_id: LIBRARY_MEDIA_BUCKET,
      p_object_path: path,
    });
    if (settlement.error) throw new Error(settlement.error.message);
  }
  if (paths.length > 0) {
    const completion = await serviceClient.rpc('complete_library_table_operation_media_cleanup', {
      p_paths: paths,
    });
    if (completion.error) throw new Error(completion.error.message);
  }
  return { expired: paths.length, deletedPaths: paths };
}
