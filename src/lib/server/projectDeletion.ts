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

export async function deleteProjectWithServerBoundary({
  authClient,
  projectId,
  userId,
  serviceClient,
}: DeleteProjectWithServerBoundaryInput): Promise<void> {
  await verifyProjectDeletionPermission(authClient, projectId, userId);

  const resolvedServiceClient = await resolveServiceClient(serviceClient);
  const { error } = await resolvedServiceClient.from('projects').delete().eq('id', projectId);

  if (error) {
    throw error;
  }
}
