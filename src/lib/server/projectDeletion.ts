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

const REFERENCE_PAGE_SIZE = 1000;
const STORAGE_DELETE_BATCH_SIZE = 100;

async function removeProjectReferenceObjects(serviceClient: SupabaseClient, projectId: string): Promise<void> {
  const storagePaths: string[] = [];
  for (let offset = 0; ; offset += REFERENCE_PAGE_SIZE) {
    const { data, error } = await serviceClient
      .from('map_reference_images')
      .select('storage_path')
      .eq('project_id', projectId)
      .range(offset, offset + REFERENCE_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{ storage_path?: unknown }>;
    for (const row of rows) {
      const path = row.storage_path;
      if (typeof path !== 'string' || !path.startsWith(`references/${projectId}/`) || path.includes('..')) {
        throw new Error('Invalid project reference storage path');
      }
      storagePaths.push(path);
    }
    if (rows.length < REFERENCE_PAGE_SIZE) break;
  }

  for (let offset = 0; offset < storagePaths.length; offset += STORAGE_DELETE_BATCH_SIZE) {
    const { error } = await serviceClient.storage
      .from('map-assets')
      .remove(storagePaths.slice(offset, offset + STORAGE_DELETE_BATCH_SIZE));
    if (error) throw new Error(error.message);
  }
}

export async function deleteProjectWithServerBoundary({
  authClient,
  projectId,
  userId,
  serviceClient,
}: DeleteProjectWithServerBoundaryInput): Promise<void> {
  await verifyProjectDeletionPermission(authClient, projectId, userId);

  const resolvedServiceClient = await resolveServiceClient(serviceClient);
  await removeProjectReferenceObjects(resolvedServiceClient, projectId);
  const { error } = await resolvedServiceClient.from('projects').delete().eq('id', projectId);

  if (error) {
    throw error;
  }
}
