import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';

import { createAuthenticatedAiUsageRecorder } from '@/lib/ai-usage/recorder';
import { validateMapSceneV3, validateMapPlanV3 } from '@/features/create-map/model/directMapSchema';
import { getUserProjectRole } from '@/lib/services/authorizationService';
import { analyzeCreateMapCollisionGrid } from './createMapCollisionAnalyzer';
import { getSupabaseServiceRoleClient } from './supabaseServiceRole';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type CollisionAnalysisInput = {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  mapId: string;
  revisionId: string;
};

export class CreateMapCollisionRequestError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = 'CreateMapCollisionRequestError';
  }
}

function reject(code: string, status: number, message: string): never {
  throw new CreateMapCollisionRequestError(code, status, message);
}

export async function analyzeSavedMapCollisionGrid(input: CollisionAnalysisInput) {
  const { supabase, userId, projectId, mapId, revisionId } = input;
  const { role } = await getUserProjectRole(supabase, projectId, userId);
  if (role !== 'admin' && role !== 'editor') reject('forbidden', 403, 'Collision analysis requires editor access');

  const { data: map, error: mapError } = await supabase
    .from('map_projects')
    .select('id, project_id, current_revision_id')
    .eq('id', mapId)
    .eq('project_id', projectId)
    .single();
  if (mapError || !map) reject('map_not_found', 404, 'Map not found');
  if (map.current_revision_id !== revisionId) reject('stale_revision', 409, 'Map revision is stale');

  const { data: revision, error: revisionError } = await supabase
    .from('map_revisions')
    .select('id, map_project_id, schema_version, status, plan, scene')
    .eq('id', revisionId)
    .eq('map_project_id', mapId)
    .single();
  if (revisionError || !revision) reject('revision_not_found', 404, 'Map revision not found');
  if (revision.schema_version !== 3 || revision.status !== 'draft') {
    reject('invalid_revision', 409, 'Map revision is not an editable V3 draft');
  }

  const plan = validateMapPlanV3(revision.plan);
  if (plan.success === false) reject('invalid_map_state', 409, 'Map Plan is invalid');
  const scene = validateMapSceneV3(plan.data, revision.scene);
  if (scene.success === false || !scene.data.mapImage?.locked) {
    reject('image_not_bound', 409, 'Ready map image is not bound');
  }
  const binding = scene.data.mapImage;

  const admin = getSupabaseServiceRoleClient();
  const { data: assets, error: assetError } = await admin
    .from('map_assets')
    .select('id, map_revision_id, asset_key, kind, status, requested_capability, provider_operation, provider_job_id, storage_path, sha256, width, height, has_transparency')
    .eq('map_revision_id', binding.sourceRevisionId)
    .eq('asset_key', 'map-image')
    .eq('kind', 'map_image')
    .limit(2);
  if (assetError) throw assetError;
  if (!Array.isArray(assets) || assets.length !== 1) {
    reject('image_not_ready', 409, 'Ready map image is unavailable');
  }
  const asset = assets[0];
  const expectedPath = `${projectId}/${mapId}/${binding.sourceRevisionId}/map-image/${asset.sha256}.png`;
  if (
    asset.map_revision_id !== binding.sourceRevisionId
    || asset.status !== 'ready'
    || asset.requested_capability !== 'direct_map_image'
    || asset.provider_operation !== 'create_image_pro'
    || typeof asset.provider_job_id !== 'string'
    || !asset.provider_job_id
    || typeof asset.sha256 !== 'string'
    || !SHA256_PATTERN.test(asset.sha256)
    || asset.width !== binding.width
    || asset.height !== binding.height
    || asset.width !== plan.data.map.width
    || asset.height !== plan.data.map.height
    || asset.has_transparency !== false
    || asset.storage_path !== expectedPath
  ) {
    reject('invalid_image_identity', 409, 'Ready map image identity is invalid');
  }

  const { data: blob, error: downloadError } = await admin.storage.from('map-assets').download(expectedPath);
  if (downloadError || !blob) reject('image_download_failed', 502, 'Ready map image could not be loaded');
  if (blob.size < PNG_SIGNATURE.length || blob.size > MAX_IMAGE_BYTES || blob.type !== 'image/png') {
    reject('invalid_image_bytes', 422, 'Ready map image is not a supported PNG');
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!Buffer.from(bytes.subarray(0, PNG_SIGNATURE.length)).equals(PNG_SIGNATURE)) {
    reject('invalid_image_bytes', 422, 'Ready map image is not a supported PNG');
  }
  const metadata = await sharp(bytes, { limitInputPixels: 1_000_000 }).metadata().catch(() => null);
  if (metadata?.format !== 'png' || metadata.width !== asset.width || metadata.height !== asset.height) {
    reject('invalid_image_dimensions', 422, 'Ready map image dimensions do not match');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== asset.sha256) reject('image_hash_mismatch', 409, 'Ready map image hash does not match');

  const grid = await analyzeCreateMapCollisionGrid({
    pngBytes: bytes,
    imageSha256: sha256,
    width: asset.width,
    height: asset.height,
  }, {
    context: {
      actorUserId: userId,
      projectId,
      feature: 'map_collision',
      operation: 'classify_region',
      correlationId: `map_collision:${randomUUID()}`,
      artifactId: revisionId,
    },
    recorder: createAuthenticatedAiUsageRecorder(supabase),
  });
  if (grid.imageSha256 !== sha256
    || grid.columns * grid.cellSize !== asset.width
    || grid.rows * grid.cellSize !== asset.height) {
    reject('collision_grid_invalid_response', 502, 'Collision analysis returned an invalid grid. Retry or edit manually.');
  }
  return grid;
}
