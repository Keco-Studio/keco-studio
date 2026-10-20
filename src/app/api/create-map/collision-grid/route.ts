import { NextResponse } from 'next/server';
import { z } from 'zod';

import { withAuth } from '@/lib/auth/route-auth';
import { AuthorizationError } from '@/lib/services/authorizationService';
import { CreateMapCollisionAnalyzerError } from '@/lib/server/createMapCollisionAnalyzer';
import {
  analyzeSavedMapCollisionGrid,
  CreateMapCollisionRequestError,
} from '@/lib/server/createMapCollisionAnalysisService';

export const maxDuration = 300;

const Body = z.object({
  projectId: z.string().uuid(),
  mapId: z.string().uuid(),
  revisionId: z.string().uuid(),
}).strict();

const PUBLIC_REQUEST_ERRORS: Record<string, string> = {
  forbidden: 'Collision analysis requires editor access',
  map_not_found: 'Map not found',
  stale_revision: 'Map revision is stale',
  revision_not_found: 'Map revision not found',
  invalid_revision: 'Map revision is not an editable V3 draft',
  invalid_map_state: 'Map Plan is invalid',
  image_not_bound: 'Ready map image is not bound',
  image_not_ready: 'Ready map image is unavailable',
  invalid_image_identity: 'Ready map image identity is invalid',
  image_download_failed: 'Ready map image could not be loaded',
  invalid_image_bytes: 'Ready map image is not a supported PNG',
  invalid_image_dimensions: 'Ready map image dimensions do not match',
  image_hash_mismatch: 'Ready map image hash does not match',
  collision_grid_invalid_response: 'Collision analysis returned an invalid grid. Retry or edit manually.',
};

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
    const collisionGrid = await analyzeSavedMapCollisionGrid({
      supabase, userId: user.id,
      projectId: body.data.projectId!, mapId: body.data.mapId!, revisionId: body.data.revisionId!,
    });
    return json({ collisionGrid });
  } catch (error) {
    if (error instanceof CreateMapCollisionRequestError) {
      return json({ error: PUBLIC_REQUEST_ERRORS[error.code] ?? 'Invalid collision analysis request', code: error.code }, error.status);
    }
    if (error instanceof AuthorizationError) {
      return json({ error: 'Project access required', code: 'forbidden' }, 403);
    }
    if (error instanceof CreateMapCollisionAnalyzerError) {
      const status = error.code === 'vision_not_configured' ? 503 : 502;
      const message = error.code === 'vision_not_configured'
        ? 'Map collision vision is not configured'
        : error.code === 'collision_grid_invalid_response'
          ? 'Collision analysis returned an invalid grid. Retry or edit manually.'
          : 'Collision analysis model is unavailable. Retry or edit manually.';
      return json({ error: message, code: error.code }, status);
    }
    console.error(`[POST /api/create-map/collision-grid] failed name=${error instanceof Error ? error.name : 'UnknownError'}`);
    return json({ error: 'Failed to analyze map collision', code: 'collision_analysis_failed' }, 502);
  }
}, {
  unauthorizedResponse: () => json({ error: 'Authentication required', code: 'unauthorized' }, 401),
});
