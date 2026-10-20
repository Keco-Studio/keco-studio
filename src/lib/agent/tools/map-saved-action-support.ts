import { z } from 'zod';
import type { PublicMapWorkspace } from '@/lib/server/createMapMcpService';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import type { ToolContext } from '../types';
import { mapService } from './map-tool-support';
import { mapContentFingerprint } from './update-map-draft';

export const mapSnapshotFields = {
  mapId: z.string().uuid(),
  revisionId: z.string().uuid(),
  saveVersion: z.number().int().nonnegative(),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
};

export const mapSnapshotParameters = {
  mapId: { type: 'string', format: 'uuid' },
  revisionId: { type: 'string', format: 'uuid' },
  saveVersion: { type: 'integer', minimum: 0 },
  expectedFingerprint: { type: 'string', pattern: '^[a-f0-9]{64}$' },
};

export type MapSnapshot = {
  mapId: string; revisionId: string; saveVersion: number; expectedFingerprint: string;
};

export async function readMapForMutation(ctx: ToolContext, projectId: string, snapshot: MapSnapshot): Promise<PublicMapWorkspace> {
  const map = await (await mapService(ctx)).readMap({ projectId, mapId: snapshot.mapId });
  const { role } = await getUserProjectRole(ctx.supabase, projectId, ctx.userId);
  if (role === 'viewer') throw new Error('This project requires admin or editor access.');
  if (map.identity.revisionId !== snapshot.revisionId || map.identity.saveVersion !== snapshot.saveVersion
    || mapContentFingerprint(map.plan, map.scene) !== snapshot.expectedFingerprint) {
    throw new Error('The map changed. Read its latest detail and confirm again.');
  }
  return map;
}
