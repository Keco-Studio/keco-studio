import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyProjectAccess } from '@/lib/services/authorizationService';
import type { GameDesignSystemDetail } from '@/lib/services/gameDesignSystemService';
import { redactGameDesignSystemDetailSources } from './sourceVisibility';

export async function redactGameDesignSystemDetailForViewer(
  supabase: SupabaseClient,
  detail: GameDesignSystemDetail,
  viewerUserId: string,
): Promise<GameDesignSystemDetail> {
  const projectIds = new Set(
    detail.versions.flatMap((version) =>
      version.source_snapshots.flatMap((snapshot) => snapshot.projectId ? [snapshot.projectId] : [])),
  );
  const readable = new Set<string>();
  await Promise.all([...projectIds].map(async (projectId) => {
    try {
      await verifyProjectAccess(supabase, projectId);
      readable.add(projectId);
    } catch {
      // Snapshot metadata remains visible, but its excerpt does not cross access boundaries.
    }
  }));
  return redactGameDesignSystemDetailSources(detail, {
    viewerUserId,
    readableProjectIds: readable,
  });
}
