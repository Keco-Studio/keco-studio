import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { z } from 'zod';

import { withAuth } from '@/lib/auth/route-auth';
import { AuthorizationError, getUserProjectRole } from '@/lib/services/authorizationService';
import {
  CreateMapCollisionAnalyzerError,
  analyzeCreateMapCollisionGrid,
} from '@/lib/server/createMapCollisionAnalyzer';
import { getSupabaseServiceRoleClient } from '@/lib/server/supabaseServiceRole';
import { validateMapSceneV3, validateMapPlanV3 } from '@/features/create-map/model/directMapSchema';

export const maxDuration = 300;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const Body = z.object({
  projectId: z.string().uuid(),
  mapId: z.string().uuid(),
  revisionId: z.string().uuid(),
}).strict();

function json(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export const POST = withAuth(async function POST(request, _context, { supabase, user }) {
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: 'Invalid collision analysis request', code: 'invalid_request' }, 400);

  try {
    const { role } = await getUserProjectRole(supabase, body.data.projectId, user.id);
    if (role !== 'admin' && role !== 'editor') {
      return json({ error: 'Collision analysis requires editor access', code: 'forbidden' }, 403);
    }

    const { data: map, error: mapError } = await supabase
      .from('map_projects')
      .select('id, project_id, current_revision_id')
      .eq('id', body.data.mapId)
      .eq('project_id', body.data.projectId)
      .single();
    if (mapError || !map) return json({ error: 'Map not found', code: 'map_not_found' }, 404);
    if (map.current_revision_id !== body.data.revisionId) {
      return json({ error: 'Map revision is stale', code: 'stale_revision' }, 409);
    }

    const { data: revision, error: revisionError } = await supabase
      .from('map_revisions')
      .select('id, map_project_id, schema_version, status, plan, scene')
      .eq('id', body.data.revisionId)
      .eq('map_project_id', body.data.mapId)
      .single();
    if (revisionError || !revision) return json({ error: 'Map revision not found', code: 'revision_not_found' }, 404);
    if (revision.schema_version !== 3 || revision.status !== 'draft') {
      return json({ error: 'Map revision is not an editable V3 draft', code: 'invalid_revision' }, 409);
    }

    const plan = validateMapPlanV3(revision.plan);
    if (plan.success === false) return json({ error: 'Map Plan is invalid', code: 'invalid_map_state' }, 409);
    const scene = validateMapSceneV3(plan.data, revision.scene);
    if (scene.success === false || !scene.data.mapImage?.locked) {
      return json({ error: 'Ready map image is not bound', code: 'image_not_bound' }, 409);
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
      return json({ error: 'Ready map image is unavailable', code: 'image_not_ready' }, 409);
    }
    const asset = assets[0];
    const expectedPath = `${body.data.projectId}/${body.data.mapId}/${binding.sourceRevisionId}/map-image/${asset.sha256}.png`;
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
      return json({ error: 'Ready map image identity is invalid', code: 'invalid_image_identity' }, 409);
    }

    const { data: blob, error: downloadError } = await admin.storage.from('map-assets').download(expectedPath);
    if (downloadError || !blob) return json({ error: 'Ready map image could not be loaded', code: 'image_download_failed' }, 502);
    if (blob.size < PNG_SIGNATURE.length || blob.size > MAX_IMAGE_BYTES || blob.type !== 'image/png') {
      return json({ error: 'Ready map image is not a supported PNG', code: 'invalid_image_bytes' }, 422);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!Buffer.from(bytes.subarray(0, PNG_SIGNATURE.length)).equals(PNG_SIGNATURE)) {
      return json({ error: 'Ready map image is not a supported PNG', code: 'invalid_image_bytes' }, 422);
    }
    const metadata = await sharp(bytes, { limitInputPixels: 1_000_000 }).metadata().catch(() => null);
    if (metadata?.format !== 'png' || metadata.width !== asset.width || metadata.height !== asset.height) {
      return json({ error: 'Ready map image dimensions do not match', code: 'invalid_image_dimensions' }, 422);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== asset.sha256) {
      return json({ error: 'Ready map image hash does not match', code: 'image_hash_mismatch' }, 409);
    }

    const collisionGrid = await analyzeCreateMapCollisionGrid({
      pngBytes: bytes,
      imageSha256: sha256,
      width: asset.width,
      height: asset.height,
    });
    return json({ collisionGrid });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return json({ error: 'Project access required', code: 'forbidden' }, 403);
    }
    if (error instanceof CreateMapCollisionAnalyzerError) {
      const status = error.code === 'vision_not_configured' ? 503 : 502;
      const message = error.code === 'vision_not_configured'
        ? 'Map collision vision is not configured'
        : error.code === 'collision_grid_invalid_response'
          ? 'Vision returned an invalid collision grid'
          : 'Map collision vision request failed';
      return json({ error: message, code: error.code }, status);
    }
    console.error(`[POST /api/create-map/collision-grid] failed name=${error instanceof Error ? error.name : 'UnknownError'}`);
    return json({ error: 'Failed to analyze map collision', code: 'collision_analysis_failed' }, 502);
  }
}, {
  unauthorizedResponse: () => json({ error: 'Authentication required', code: 'unauthorized' }, 401),
});
