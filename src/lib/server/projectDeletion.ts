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
  storage_file_ids: string[];
  storage_file_owner_ids: string[];
  storage_file_bytes: number[];
};

const ACCOUNTED_STORAGE_BUCKETS = [
  'library-media-files',
  'project-assets',
  'map-assets',
  'character-assets',
  'tiptap-images',
] as const;

type AccountedStorageBucket = typeof ACCOUNTED_STORAGE_BUCKETS[number];

function isAccountedStorageBucket(bucketId: unknown): bucketId is AccountedStorageBucket {
  return typeof bucketId === 'string'
    && (ACCOUNTED_STORAGE_BUCKETS as readonly string[]).includes(bucketId);
}

function isCleanupPathForProject({
  bucketId,
  projectId,
  ownerId,
  path,
}: {
  bucketId: AccountedStorageBucket;
  projectId: string;
  ownerId: string;
  path: unknown;
}): boolean {
  if (typeof path !== 'string' || path.includes('..')) return false;
  if (bucketId === 'map-assets') {
    return path.startsWith(`references/${projectId}/`) || path.startsWith(`${projectId}/`);
  }
  if (bucketId === 'character-assets') return path.startsWith(`${projectId}/`);
  if (bucketId === 'tiptap-images') return path.startsWith(`${ownerId}/${projectId}/`);
  return path.startsWith(`${ownerId}/${projectId}/`);
}

function cleanupRow(value: unknown, expectedId: string): ProjectStorageCleanupRow {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const paths = row.storage_paths;
  const fileIds = row.storage_file_ids;
  const ownerIds = row.storage_file_owner_ids;
  const bytes = row.storage_file_bytes;
  if (
    row.id !== expectedId
    || typeof row.project_id !== 'string'
    || !isAccountedStorageBucket(row.bucket_id)
    || !Array.isArray(paths)
    || !Array.isArray(fileIds)
    || !Array.isArray(ownerIds)
    || !Array.isArray(bytes)
    || paths.length === 0
    || paths.length !== fileIds.length
    || paths.length !== ownerIds.length
    || paths.length !== bytes.length
    || fileIds.some((id) => typeof id !== 'string')
    || ownerIds.some((ownerId) => typeof ownerId !== 'string')
    || bytes.some((size) => typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0)
    || paths.some((path, index) => !isCleanupPathForProject({
      bucketId: row.bucket_id as AccountedStorageBucket,
      projectId: row.project_id as string,
      ownerId: ownerIds[index] as string,
      path,
    }))
  ) {
    throw new Error('Invalid project storage cleanup job');
  }
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    bucket_id: row.bucket_id as AccountedStorageBucket,
    storage_paths: paths as string[],
    storage_file_ids: fileIds as string[],
    storage_file_owner_ids: ownerIds as string[],
    storage_file_bytes: bytes as number[],
  };
}

export async function deleteAccountedStorageFile({
  client,
  bucketId,
  objectPath,
}: {
  client: SupabaseClient;
  bucketId: AccountedStorageBucket;
  objectPath: string;
}): Promise<void> {
  const removal = await client.storage.from(bucketId).remove([objectPath]);
  if (removal.error) throw new Error(removal.error.message);

  const settlement = await client.rpc('settle_project_storage_file_deletion', {
    p_bucket_id: bucketId,
    p_object_path: objectPath,
  });
  if (settlement.error) throw new Error(settlement.error.message);
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
    .select('id, project_id, bucket_id, storage_paths, storage_file_ids, storage_file_owner_ids, storage_file_bytes')
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
      for (const path of job.storage_paths.slice(offset, offset + STORAGE_DELETE_BATCH_SIZE)) {
        const settlement = await resolvedServiceClient.rpc('service_settle_project_storage_file_deletion', {
          p_bucket_id: job.bucket_id,
          p_object_path: path,
        });
        if (settlement.error) throw new Error(settlement.error.message);
      }
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
  if (!Array.isArray(data)) throw new Error('Invalid project deletion response');
  const cleanupJobIds = data.map((value) => {
    const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    if (typeof row.cleanup_job_id !== 'string') throw new Error('Invalid project deletion response');
    return row.cleanup_job_id;
  });
  return { cleanupJobId: cleanupJobIds[0] ?? null, cleanupJobIds };
}
