import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyProjectDeletionPermission } from '@/lib/services/authorizationService';

type DeleteProjectWithServerBoundaryInput = {
  authClient: SupabaseClient;
  projectId: string;
  userId: string;
  serviceClient?: SupabaseClient;
};

async function resolveServiceClient(explicitClient?: SupabaseClient): Promise<SupabaseClient> {
  if (explicitClient) {
    return explicitClient;
  }

  const { getSupabaseServiceRoleClient } = await import('@/lib/server/supabaseServiceRole');
  return getSupabaseServiceRoleClient();
}

const STORAGE_DELETE_BATCH_SIZE = 100;

type ProjectStorageCleanupRow = {
  id: string;
  project_id: string;
  bucket_id: string;
  storage_paths: string[];
};

function cleanupRow(value: unknown, expectedId: string): ProjectStorageCleanupRow {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (
    row.id !== expectedId
    || typeof row.project_id !== 'string'
    || (row.bucket_id !== 'map-assets' && row.bucket_id !== 'character-assets')
    || !Array.isArray(row.storage_paths)
    || row.storage_paths.length === 0
    || row.storage_paths.some((path) => typeof path !== 'string'
      || (!path.startsWith(`references/${row.project_id}/`) && !path.startsWith(`${row.project_id}/`))
      || path.includes('..'))
  ) {
    throw new Error('Invalid project storage cleanup job');
  }
  return row as ProjectStorageCleanupRow;
}

export async function processProjectStorageCleanupJob({
  cleanupJobId,
  serviceClient,
}: {
  cleanupJobId: string;
  serviceClient?: SupabaseClient;
}): Promise<void> {
  const resolvedServiceClient = await resolveServiceClient(serviceClient);
  const { data, error } = await resolvedServiceClient
    .from('project_storage_cleanup_jobs')
    .select('id, project_id, bucket_id, storage_paths')
    .eq('id', cleanupJobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  const job = cleanupRow(data, cleanupJobId);

  await resolvedServiceClient.from('project_storage_cleanup_jobs').update({
    status: 'processing',
    last_error: null,
  }).eq('id', cleanupJobId);

  try {
    for (let offset = 0; offset < job.storage_paths.length; offset += STORAGE_DELETE_BATCH_SIZE) {
      const removal = await resolvedServiceClient.storage
        .from(job.bucket_id)
        .remove(job.storage_paths.slice(offset, offset + STORAGE_DELETE_BATCH_SIZE));
      if (removal.error) throw new Error(removal.error.message);
    }
    const deletion = await resolvedServiceClient
      .from('project_storage_cleanup_jobs')
      .delete()
      .eq('id', cleanupJobId);
    if (deletion.error) throw new Error(deletion.error.message);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Storage cleanup failed';
    await resolvedServiceClient.from('project_storage_cleanup_jobs').update({
      status: 'failed',
      last_error: message.slice(0, 1000),
    }).eq('id', cleanupJobId);
    throw cause;
  }
}

export async function deleteProjectWithServerBoundary({
  authClient,
  projectId,
  userId,
  serviceClient,
}: DeleteProjectWithServerBoundaryInput): Promise<{
  cleanupJobId: string | null;
  cleanupJobIds: string[];
}> {
  await verifyProjectDeletionPermission(authClient, projectId, userId);

  const resolvedServiceClient = await resolveServiceClient(serviceClient);
  const { data, error } = await resolvedServiceClient.rpc('delete_project_and_enqueue_storage_cleanup', {
    p_project_id: projectId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
  const cleanupJobId = row?.cleanup_job_id;
  const characterCleanupJobId = row?.character_cleanup_job_id;
  if (cleanupJobId !== null && cleanupJobId !== undefined && typeof cleanupJobId !== 'string') {
    throw new Error('Invalid project deletion response');
  }
  if (characterCleanupJobId !== null && characterCleanupJobId !== undefined
    && typeof characterCleanupJobId !== 'string') {
    throw new Error('Invalid project deletion response');
  }
  const cleanupJobIds = [cleanupJobId, characterCleanupJobId]
    .filter((value): value is string => typeof value === 'string');
  return { cleanupJobId: cleanupJobIds[0] ?? null, cleanupJobIds };
}
